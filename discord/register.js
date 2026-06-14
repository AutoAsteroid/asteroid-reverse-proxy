
const { SlashCommandBuilder } = require('@discordjs/builders');
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");
const { APPLICATION_ID, GUILD_ID } = require("./config.json");

// Load environment variables that includes our discord bot token to load our commands
require("dotenv").config({ quiet: true });

// This file should only be ran once when updating your commands: node register.js
const COMMANDS = [
    new SlashCommandBuilder()
        .setName('console')
        .setDescription('Runs a command into server console.')
        .addStringOption(option => option.setName('command')
            .setDescription('The command to run.')
            .setRequired(true)),
    new SlashCommandBuilder()
        .setName('players')
        .setDescription('Displays the players currently online.'),
    new SlashCommandBuilder()
        .setName('alts')
        .setDescription('Gets all the linked alt accounts of a player.')
        .addStringOption(option => option.setName('username')
            .setDescription('The username to check.')
            .setRequired(true))
        .addBooleanOption(option => option.setName('trace')
            .setDescription('Prints the responding connecion tree if true.')
            .setRequired(false)),
    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Blacklist a player from joining the server.')
        .addStringOption(option => option.setName('username')
            .setDescription('The username to blacklist.')
            .setRequired(true))
        .addStringOption(option => option.setName('duration')
            .setDescription('The duration this ban should last.'))
        .addStringOption(option => option.setName('reason')
            .setDescription('The reason for issuing this ban.')),
    new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Removes a player from the blacklist.')
        .addStringOption(option => option.setName('username')
            .setDescription('The username to unban.')
            .setRequired(true))
        .addStringOption(option => option.setName('reason')
            .setDescription('The reason for issuing this unban.')),
].map((command) => command.toJSON());

// Register the discord slash commands to your bot for you private discord server
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
rest.put(Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID), { body: COMMANDS });