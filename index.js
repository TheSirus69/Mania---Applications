const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { SlashCommandBuilder } = require('@discordjs/builders');
const fs = require('fs');

// Load configuration from config.json
const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] });

const { token, clientId, guildId, commandChannelId, applicationsChannelId, applicationTypes } = config;

client.once('ready', () => {
    console.log(`Bot is ready as ${client.user.tag}`);
});

const commands = [
    new SlashCommandBuilder()
        .setName('apply')
        .setDescription('Start the application process')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand() && !interaction.isButton() && !interaction.isModalSubmit()) return;

    if (interaction.isCommand()) {
        const { commandName } = interaction;

        if (commandName === 'apply') {
            const actionRows = [];

            applicationTypes.forEach((type, index) => {
                if (index % 5 === 0) {
                    actionRows.push(new ActionRowBuilder());
                }
                actionRows[actionRows.length - 1].addComponents(
                    new ButtonBuilder()
                        .setCustomId(type.id)
                        .setLabel(type.label)
                        .setStyle(ButtonStyle[type.color])
                );
            });

            const embed = new EmbedBuilder()
                .setTitle('Apply for a Position')
                .setDescription('Click a button below to apply:')
                .setColor(0x00ff00); // Light green for the embed with buttons

            const commandChannel = client.channels.cache.get(commandChannelId);
            await commandChannel.send({ embeds: [embed], components: actionRows });

            await interaction.reply({ content: 'Application buttons have been posted.', ephemeral: true });
        }
    } else if (interaction.isButton()) {
        if (interaction.customId.startsWith('apply_')) {
            const applicationType = applicationTypes.find(type => type.id === interaction.customId);

            const modal = new ModalBuilder()
                .setCustomId(`applicationModal_${interaction.customId}`)
                .setTitle(`Apply for ${applicationType.label}`)
                .addComponents(
                    applicationType.form.map(field => new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId(field.customId)
                            .setLabel(field.label)
                            .setStyle(TextInputStyle[field.style])
                            .setPlaceholder(field.placeholder)
                            .setRequired(field.required)
                    ))
                );

            await interaction.showModal(modal);
        } else if (interaction.customId.startsWith('acceptApplication_') || interaction.customId.startsWith('rejectApplication_')) {
            const applicationId = interaction.customId.split('_')[1];

            if (interaction.customId.startsWith('rejectApplication_')) {
                const modal = new ModalBuilder()
                    .setCustomId(`rejectModal_${applicationId}`)
                    .setTitle('Reason for Rejection')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('reason')
                                .setLabel('Reason')
                                .setStyle(TextInputStyle.Paragraph)
                                .setPlaceholder('Enter the reason for rejection')
                                .setRequired(true)
                        )
                    );
                await interaction.showModal(modal);
            } else {
                try {
                    const applicationChannel = client.channels.cache.get(applicationsChannelId);
                    const applicationMessage = await applicationChannel.messages.fetch(applicationId);

                    if (applicationMessage) {
                        const embed = EmbedBuilder.from(applicationMessage.embeds[0]);
                        embed.setColor(0x00ff00); // Green for accepted

                        if (!embed.footer || !embed.footer.text) {
                            throw new Error('Footer text not found');
                        }

                        const userIdMatch = embed.footer.text.match(/\((\d+)\)$/);
                        if (!userIdMatch) {
                            throw new Error('User ID not found in embed footer');
                        }
                        const userId = userIdMatch[1];

                        const member = await interaction.guild.members.fetch(userId);
                        const role = interaction.guild.roles.cache.get(applicationTypes.find(type => type.label === embed.title.split(' ')[2]).role);

                        await member.roles.add(role);
                        await member.send('Congratulations! Your application has been accepted.');

                        await applicationMessage.edit({ embeds: [embed], components: [] });
                        await interaction.reply({ content: 'The application has been accepted.', ephemeral: true });
                    } else {
                        throw new Error('Application message not found for ID');
                    }
                } catch (error) {
                    console.error(error.message);
                    await interaction.reply({ content: error.message, ephemeral: true });
                }
            }
        }
    } else if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('applicationModal_')) {
            const applicationType = applicationTypes.find(type => `applicationModal_${type.id}` === interaction.customId);

            if (!applicationType) {
                console.error('Application type not found for interaction:', interaction.customId);
                await interaction.reply({ content: 'Application type not found.', ephemeral: true });
                return;
            }

            const fields = applicationType.form.reduce((acc, field) => {
                acc[field.customId] = interaction.fields.getTextInputValue(field.customId);
                return acc;
            }, {});

            const embedDescription = Object.entries(fields).map(([key, value]) => `**${applicationType.form.find(f => f.customId === key).label}:** ${value}`).join('\n');

            const embed = new EmbedBuilder()
                .setTitle(`Application for ${applicationType.label}`)
                .setDescription(embedDescription)
                .setColor(0x00ff00)
                .setFooter({ text: `Submitted by ${interaction.user.tag} (${interaction.user.id})` });

            const applicationsChannel = client.channels.cache.get(applicationsChannelId);
            const applicationMessage = await applicationsChannel.send({ embeds: [embed] });

            await interaction.reply({ content: 'Your application has been submitted!', ephemeral: true });

            // Update the buttons with the correct message ID
            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`acceptApplication_${applicationMessage.id}`)
                        .setLabel('Accept Application')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`rejectApplication_${applicationMessage.id}`)
                        .setLabel('Reject Application')
                        .setStyle(ButtonStyle.Danger)
                );
            await applicationMessage.edit({ components: [buttons] });
        } else if (interaction.customId.startsWith('rejectModal_')) {
            const applicationId = interaction.customId.split('_')[1];
            const reason = interaction.fields.getTextInputValue('reason');

            try {
                const applicationChannel = client.channels.cache.get(applicationsChannelId);
                const applicationMessage = await applicationChannel.messages.fetch(applicationId);

                if (applicationMessage) {
                    const embed = EmbedBuilder.from(applicationMessage.embeds[0]);
                    embed.setColor(0xff0000); // Red for rejected
                    embed.addFields({ name: 'Reason for Rejection', value: reason });

                    await applicationMessage.edit({ embeds: [embed], components: [] });
                    await interaction.reply({ content: 'The application has been rejected.', ephemeral: true });
                } else {
                    throw new Error('Application message not found for ID');
                }
            } catch (error) {
                console.error(error.message);
                await interaction.reply({ content: error.message, ephemeral: true });
            }
        }
    }
});

client.login(token);
