require("dotenv").config();
const ffmpegPath = require("ffmpeg-static");
process.env.FFMPEG_PATH = ffmpegPath;

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const { Player, QueryType, QueueRepeatMode } = require("discord-player");
const { DefaultExtractors } = require("@discord-player/extractor");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

const player = new Player(client, {
  deafenOnJoin: true,
  lagMonitor: 1000,
  ytdlOptions: {
    quality: "highestaudio",
    highWaterMark: 1 << 25,
  },
});

const trackStats = new Map(); // { guildId: Map<title, count> }
const CACHE_TTL_MS = 10 * 60 * 1000;
const soundCloudCache = new Map();

const setSoundCloudCache = (query, track) => {
  soundCloudCache.set(query, {
    track,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
};

const pruneSoundCloudCache = () => {
  const now = Date.now();
  for (const [query, payload] of soundCloudCache.entries()) {
    if (payload.expiresAt <= now) {
      soundCloudCache.delete(query);
    }
  }
};
setInterval(pruneSoundCloudCache, CACHE_TTL_MS);

const getCachedSoundCloudTrack = async (query, user) => {
  const cached = soundCloudCache.get(query);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.track;
  }

  const search = await player.search(query, {
    requestedBy: user,
    searchEngine: QueryType.SOUNDCLOUD,
  });

  const firstTrack = search?.tracks?.[0];
  if (!firstTrack) return null;

  setSoundCloudCache(query, firstTrack);
  return firstTrack;
};

const buildControlRow = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("player:pause")
      .setLabel("⏸️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("player:resume")
      .setLabel("▶️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("player:skip")
      .setLabel("⏭️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("player:shuffle")
      .setLabel("🔀")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("player:stop")
      .setLabel("🛑")
      .setStyle(ButtonStyle.Danger)
  );

(async () => {
  try {
    await player.extractors.loadMulti(DefaultExtractors);
    console.log("✅ Extractores cargados correctamente.");
  } catch (e) {
    console.error("❌ Error cargando extractores:", e);
  }
})();

// =========================
// 🎵 EVENTOS DEL PLAYER
// =========================
player.events.on("playerStart", (queue, track) => {
  console.log(
    `🤖 Logueado como ${client.user.tag} | Canción: "${track.title}" reproducida desde ${track.source}`
  );

  if (!queue.metadata.channel) return;

  if (!trackStats.has(queue.guild.id)) {
    trackStats.set(queue.guild.id, new Map());
  }
  const guildStats = trackStats.get(queue.guild.id);
  guildStats.set(track.title, (guildStats.get(track.title) || 0) + 1);

  const embed = new EmbedBuilder()
    .setTitle("🎶 Reproduciendo ahora")
    .setDescription(
      `**${track.title}**\n👤 Por: ${track.author}\n⏱️ Duración: ${
        track.duration || "Desconocida"
      }`
    )
    .setColor("Purple");

  if (
    typeof track.thumbnail === "string" &&
    track.thumbnail.startsWith("http")
  ) {
    embed.setThumbnail(track.thumbnail);
  }

  queue.metadata.channel.send({
    embeds: [embed],
    components: [buildControlRow()],
  });
});

player.events.on("playerError", (queue, error) => {
  console.log(`❌ Error de Audio: ${error.message}`);

  if (queue.metadata.channel) {
    queue.metadata.channel.send(
      `⚠️ No se pudo reproducir el audio: ${error.message}. Saltando a la siguiente pista…`
    );
  }

  const dispatcher = queue.node;
  if (dispatcher && dispatcher.isPlaying()) {
    dispatcher.skip().catch((err) =>
      console.error("❌ Error al saltar tras fallo:", err)
    );
  }
});

player.events.on("error", (queue, error) => {
  console.log(`❌ Error General: ${error.message}`);
});

// =========================
// ⚙️ COMANDOS Y BOTONES
// =========================
client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton()) {
    const queue = player.nodes.get(interaction.guildId);
    if (!queue) {
      return interaction.reply({
        content: "❌ No hay música reproduciéndose.",
        ephemeral: true,
      });
    }

    switch (interaction.customId) {
      case "player:pause":
        queue.node.setPaused(true);
        return interaction.reply({
          content: "⏸️ Música pausada.",
          ephemeral: true,
        });
      case "player:resume":
        queue.node.setPaused(false);
        return interaction.reply({
          content: "▶️ Música reanudada.",
          ephemeral: true,
        });
      case "player:skip":
        queue.node.skip();
        return interaction.reply({
          content: "⏭️ Canción saltada.",
          ephemeral: true,
        });
      case "player:shuffle":
        if (queue.tracks.size < 2) {
          return interaction.reply({
            content: "❌ No hay suficientes canciones para mezclar.",
            ephemeral: true,
          });
        }
        queue.tracks.shuffle();
        return interaction.reply({
          content: "🔀 Cola mezclada.",
          ephemeral: true,
        });
      case "player:stop":
        queue.delete();
        return interaction.reply({
          content: "🛑 Música detenida y cola borrada.",
          ephemeral: true,
        });
      default:
        return interaction.reply({
          content: "⚠️ Botón desconocido.",
          ephemeral: true,
        });
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const command = interaction.commandName;

  if (command === "reproducete") {
    const query = interaction.options.getString("cancion");
    const member = interaction.guild.members.cache.get(
      interaction.member.user.id
    );
    const channel = member?.voice?.channel;

    if (!channel) {
      return interaction.reply({
        content: "❌ Debes estar en un canal de voz.",
        ephemeral: true,
      });
    }

    if (!channel.joinable) {
      return interaction.reply({
        content: "❌ No tengo permiso para entrar al canal.",
        ephemeral: true,
      });
    }

    if (!channel.speakable) {
      return interaction.reply({
        content: "❌ No tengo permiso para hablar en el canal.",
        ephemeral: true,
      });
    }

    const botMember = interaction.guild.members.me;
    const perms = channel.permissionsFor(botMember);
    if (
      !perms?.has(PermissionsBitField.Flags.Connect) ||
      !perms?.has(PermissionsBitField.Flags.Speak)
    ) {
      return interaction.reply({
        content: "❌ Me faltan permisos de Conectar y Hablar.",
        ephemeral: true,
      });
    }

    const trackPromise = getCachedSoundCloudTrack(query, interaction.user);
    await interaction.deferReply();

    try {
      const cachedTrack = await trackPromise;

      if (!cachedTrack) {
        return interaction.editReply(
          "❌ No se encontró la canción en SoundCloud."
        );
      }

      const result = await player.play(channel, cachedTrack, {
        nodeOptions: {
          metadata: { channel: interaction.channel },
          volume: 50,
          bufferingTimeout: 1000,
          leaveOnEmpty: true,
          leaveOnEmptyCooldown: 300000,
          leaveOnEnd: true,
          leaveOnEndCooldown: 300000,
        },
        searchEngine: QueryType.SOUNDCLOUD,
      });

      if (!result?.track) {
        return interaction.editReply(
          "❌ No se encontró la canción en SoundCloud."
        );
      }

      return interaction.editReply(
        `✅ **${result.track.title}** añadida a la cola.`
      );
    } catch (e) {
      console.error("❌ Error al reproducir:", e);
      return interaction.editReply(`❌ Error: ${e.message}`);
    }
  }

  if (command === "saltar") {
    const queue = player.nodes.get(interaction.guild.id);
    if (!queue || !queue.isPlaying()) {
      return interaction.reply({
        content: "❌ No hay nada sonando.",
        ephemeral: true,
      });
    }

    const posicion = interaction.options.getInteger("posicion");
    if (posicion) {
      if (posicion < 1 || posicion > queue.tracks.size) {
        return interaction.reply({
          content: `❌ La cola solo tiene ${queue.tracks.size} canciones.`,
          ephemeral: true,
        });
      }
      queue.node.skipTo(posicion - 1);
      return interaction.reply(`⏭️ Saltando a la canción #${posicion}.`);
    }

    queue.node.skip();
    return interaction.reply("⏭️ Canción saltada.");
  }

  if (command === "detener") {
    const queue = player.nodes.get(interaction.guild.id);
    if (!queue) {
      return interaction.reply({
        content: "❌ No estoy conectado.",
        ephemeral: true,
      });
    }
    queue.delete();
    return interaction.reply("🛑 Música detenida y cola borrada.");
  }

  if (command === "cola") {
    const queue = player.nodes.get(interaction.guild.id);
    if (!queue || queue.tracks.size === 0) {
      return interaction.reply({
        content: "📜 La cola está vacía.",
        ephemeral: true,
      });
    }

    const tracks = queue.tracks
      .toArray()
      .slice(0, 10)
      .map((t, i) => `${i + 1}. **${t.title}**`)
      .join("\n");

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("📜 Cola")
          .setDescription(tracks)
          .setColor("Green"),
      ],
    });
  }

  if (command === "eliminar") {
    const queue = player.nodes.get(interaction.guild.id);
    if (!queue || queue.tracks.size === 0) {
      return interaction.reply({
        content: "❌ No hay canciones en la cola.",
        ephemeral: true,
      });
    }

    const posicion = interaction.options.getInteger("posicion");
    if (posicion < 1 || posicion > queue.tracks.size) {
      return interaction.reply({
        content: `❌ Ingresa un número entre 1 y ${queue.tracks.size}.`,
        ephemeral: true,
      });
    }

    const trackList = queue.tracks.toArray();
    const trackToRemove = trackList[posicion - 1];

    const exito = queue.node.remove(trackToRemove);

    if (exito) {
      return interaction.reply(
        `🗑️ **${trackToRemove.title}** fue eliminada de la cola.`
      );
    } else {
      return interaction.reply({
        content: "❌ Hubo un problema al intentar eliminar la canción.",
        ephemeral: true,
      });
    }
  }

  if (command === "pausar") {
    const queue = player.nodes.get(interaction.guild.id);
    if (!queue || !queue.isPlaying()) {
      return interaction.reply({
        content: "❌ No hay música reproduciéndose.",
        ephemeral: true,
      });
    }
    queue.node.setPaused(true);
    return interaction.reply("⏸️ Música pausada.");
  }

  if (command === "reanudar") {
    const queue = player.nodes.get(interaction.guild.id);
    if (!queue) {
      return interaction.reply({
        content: "❌ No hay sesión activa.",
        ephemeral: true,
      });
    }
    queue.node.setPaused(false);
    return interaction.reply("▶️ Música reanudada.");
  }

  if (command === "ahora") {
    const queue = player.nodes.get(interaction.guild.id);
    if (!queue || !queue.currentTrack) {
      return interaction.reply({
        content: "❌ No hay nada sonando en este momento.",
        ephemeral: true,
      });
    }

    const track = queue.currentTrack;
    const embed = new EmbedBuilder()
      .setTitle("🎵 Reproduciendo Ahora")
      .setDescription(`**${track.title}**\n👤 Por: ${track.author}`)
      .setColor("Blue");

    if (track.thumbnail && track.thumbnail.startsWith("http")) {
      embed.setThumbnail(track.thumbnail);
    }

    return interaction.reply({ embeds: [embed] });
  }

  if (command === "limpiar") {
    const queue = player.nodes.get(interaction.guild.id);
    if (!queue || queue.tracks.size === 0) {
      return interaction.reply({
        content: "❌ La cola ya está vacía.",
        ephemeral: true,
      });
    }
    queue.tracks.clear();
    return interaction.reply(
      "🗑️ Cola limpiada (se mantiene la canción actual)."
    );
  }

  if (command === "mezclar") {
    const queue = player.nodes.get(interaction.guild.id);
    if (!queue || queue.tracks.size < 2) {
      return interaction.reply({
        content: "❌ No hay suficientes canciones para mezclar.",
        ephemeral: true,
      });
    }
    queue.tracks.shuffle();
    return interaction.reply("🔀 Cola mezclada aleatoriamente.");
  }

  if (command === "loop") {
    const queue = player.nodes.get(interaction.guild.id);
    if (!queue) {
      return interaction.reply({
        content: "❌ No hay música reproduciéndose.",
        ephemeral: true,
      });
    }

    const modo = interaction.options.getString("modo");
    if (modo === "track") {
      queue.setRepeatMode(QueueRepeatMode.TRACK);
      return interaction.reply("🔂 Repitiendo la canción actual.");
    } else if (modo === "queue") {
      queue.setRepeatMode(QueueRepeatMode.QUEUE);
      return interaction.reply("🔁 Repitiendo toda la cola.");
    } else {
      queue.setRepeatMode(QueueRepeatMode.OFF);
      return interaction.reply("➡️ Repetición desactivada.");
    }
  }

  if (command === "top") {
    const guildStats = trackStats.get(interaction.guild.id);
    if (!guildStats || guildStats.size === 0) {
      return interaction.reply({
        content: "📊 Aún no hay estadísticas disponibles.",
        ephemeral: true,
      });
    }

    const listado = Array.from(guildStats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(
        (entry, i) => `${i + 1}. **${entry[0]}** — ${entry[1]} reproducciones`
      )
      .join("\n");

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🏆 Top canciones del servidor")
          .setDescription(listado)
          .setColor("Gold"),
      ],
    });
  }
});

// =========================
// 🚀 READY
// =========================
client.once("clientReady", (c) => {
  console.log(`🤖 Logueado como ${c.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);