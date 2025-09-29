import 'dotenv/config';
import { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes, PermissionFlagsBits } from 'discord.js';
import { joinVoiceChannel, EndBehaviorType, getVoiceConnection, VoiceReceiver } from '@discordjs/voice';
import prism from 'prism-media';
import { spawn } from 'node:child_process';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ensureTranscribe, transcribeBuffer } from './transcribe.js';
import { loadMapping, setPlayer, setVoice, getPlayer, listPlayers } from './playerMap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('Missing DISCORD_TOKEN in environment. Create a bot at https://discord.com/developers');
  process.exit(1);
}

// Register slash commands on startup (guild-scoped for fast updates if GUILD_ID set)
async function registerCommands(clientId) {
  const commands = [
    new SlashCommandBuilder().setName('join').setDescription('Join the current voice channel'),
    new SlashCommandBuilder().setName('leave').setDescription('Leave the current voice channel'),
    new SlashCommandBuilder()
      .setName('assign')
      .setDescription('Assign a Discord user to a Player and TTS voice')
      .addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(true))
      .addStringOption(o => o.setName('player').setDescription('Player name').setRequired(true))
      .addStringOption(o => o.setName('voice').setDescription('TTS voice id').setRequired(false)),
    new SlashCommandBuilder()
      .setName('voice')
      .setDescription('Set the TTS voice for a user')
      .addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(true))
      .addStringOption(o => o.setName('voice').setDescription('TTS voice id').setRequired(true)),
    new SlashCommandBuilder()
      .setName('whois')
      .setDescription('Show mapping for a user')
      .addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(true)),
    new SlashCommandBuilder().setName('players').setDescription('List all user->player mappings')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const guildId = process.env.GUILD_ID;
  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log(`Slash commands registered for guild ${guildId}.`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log('Global slash commands registered (may take up to 1 hour to appear).');
    }
  } catch (err) {
    console.warn('Failed to register slash commands:', err);
  }
}

function joinChannel(channel) {
  return joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });
}

function decodeOpusStream(opusStream) {
  // Decode to signed 16-bit PCM, 48kHz, stereo from Discord
  return opusStream.pipe(new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 }));
}

async function resampleTo16kMonoWav(pcm48kStereoBuffer) {
  // Requires ffmpeg available in PATH
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', 'pipe:0',
      '-f', 'wav', '-ar', '16000', '-ac', '1', 'pipe:1',
      '-loglevel', 'error'
    ]);
    const chunks = [];
    ff.stdout.on('data', (d) => chunks.push(d));
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited with code ${code}`));
      resolve(Buffer.concat(chunks));
    });
    ff.stdin.end(pcm48kStereoBuffer);
  });
}

async function handleUtterance(userId, pcmReadable) {
  // Collect the PCM until silence end
  const chunks = [];
  for await (const chunk of pcmReadable) chunks.push(chunk);
  const buf48kStereo = Buffer.concat(chunks);
  if (buf48kStereo.length === 0) return;

  let wavMono16k;
  try {
    wavMono16k = await resampleTo16kMonoWav(buf48kStereo);
  } catch (err) {
    console.warn('Resample failed; cannot transcribe without ffmpeg (install and add to PATH).', err);
    return;
  }

  const transcript = await transcribeBuffer(wavMono16k).catch((e) => ({ text: '', error: String(e) }));

  const mapping = getPlayer(userId);
  const who = mapping?.displayName || mapping?.playerId || `<@${userId}>`;
  if (transcript?.text) {
    console.log(`[speech] ${who}: ${transcript.text}`);
  } else {
    console.log(`[speech] ${who}: (no transcript)`);
    if (transcript?.error) console.warn('Transcription error:', transcript.error);
  }
  // TODO: emit into your app bus; e.g., write to a file/IPC/HTTP for Blossom to consume.
}

async function main() {
  await ensureTranscribe();
  await loadMapping(resolve(__dirname, '../data/players.json'));

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

  client.once(Events.ClientReady, async (c) => {
    console.log(`Logged in as ${c.user.tag}`);
    await registerCommands(c.user.id);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      if (interaction.commandName === 'join') {
        const channel = interaction.member?.voice?.channel;
        if (!channel) return interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
        const connection = joinChannel(channel);
        connection.receiver.speaking.on('start', (userId) => {
          const opus = connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 800 } });
          const pcm = decodeOpusStream(opus);
          handleUtterance(userId, pcm).catch(console.error);
        });
        return interaction.reply('Joined and listening.');
      }
      if (interaction.commandName === 'leave') {
        const connection = getVoiceConnection(interaction.guildId);
        if (!connection) return interaction.reply({ content: 'Not connected.', ephemeral: true });
        connection.destroy();
        return interaction.reply('Left the voice channel.');
      }
      if (interaction.commandName === 'assign') {
        const user = interaction.options.getUser('user', true);
        const player = interaction.options.getString('player', true);
        const voice = interaction.options.getString('voice', false) || null;
        const entry = await setPlayer(user.id, player, voice);
        return interaction.reply(`Assigned <@${user.id}> → player '${entry.playerId}'${entry.ttsVoiceId ? ` (voice: ${entry.ttsVoiceId})` : ''}.`);
      }
      if (interaction.commandName === 'voice') {
        const user = interaction.options.getUser('user', true);
        const voice = interaction.options.getString('voice', true);
        const entry = await setVoice(user.id, voice);
        return interaction.reply(`Set voice for <@${user.id}> to '${entry.ttsVoiceId}'.`);
      }
      if (interaction.commandName === 'whois') {
        const user = interaction.options.getUser('user', true);
        const entry = getPlayer(user.id);
        if (!entry) return interaction.reply({ content: 'No mapping found.', ephemeral: true });
        return interaction.reply(`whois <@${user.id}> → player '${entry.playerId}'${entry.ttsVoiceId ? ` (voice: ${entry.ttsVoiceId})` : ''}.`);
      }
      if (interaction.commandName === 'players') {
        const list = listPlayers();
        if (list.length === 0) return interaction.reply('No players mapped.');
        const lines = list.map((e) => `• <@${e.userId}> → '${e.playerId}'${e.ttsVoiceId ? ` (voice: ${e.ttsVoiceId})` : ''}`);
        return interaction.reply(lines.join('\n'));
      }
    } catch (err) {
      console.error('Command error:', err);
      try { await interaction.reply({ content: 'Error: ' + String(err), ephemeral: true }); } catch {}
    }
  });

  await client.login(TOKEN);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
