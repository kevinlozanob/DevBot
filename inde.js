require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const { LavalinkManager } = require("lavalink-client");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

const lavalinkManager = new LavalinkManager({
  nodes: [
    {
      authorization: "youshallnotpass",
      host: "localhost",
      port: 8080,
      id: "main-node",
      secure: false,
    },
  ],
  sendToShard: (guildId, payload) =>
    client.guilds.cache.get(guildId)?.shard?.send(payload),
  client: {
    id: process.env.CLIENT_ID,
    username: "DevBot",
  },
  playerOptions: {
    clientBasedPositionUpdateInterval: 150,
    defaultSearchPlatform: "ytsearch",
    volumeDecrementer: 0.75,
    onDisconnect: {
      autoReconnect: true,
      destroyPlayer: false,
    },
    onEmptyQueue: {
      destroyAfterMs: 30_000,
    },
  },
  queueOptions: {
    maxPreviousTracks: 25,
  },
});

const trackStats = new Map();

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

//
// --- MANEJO DE NODOS / RECONEXIÓN ---
//
const reconnectState = new Map(); // nodeId -> { attempts, timer }

function scheduleReconnect(node) {
  const nodeId = node.id;
  const current = reconnectState.get(nodeId) || { attempts: 0, timer: null };

  if (current.attempts >= 10) {
    console.error(
      `Nodo ${nodeId}: se alcanzó el máximo de intentos de reconexión.`
    );
    return;
  }

  const attempts = current.attempts + 1;
  const delay = 3000 * attempts;

  if (current.timer) clearTimeout(current.timer);

  console.warn(
    `🔁 Nodo ${nodeId}: intentando reconectar (intento ${attempts}) en ${
      delay / 1000
    }s...`
  );

  const timer = setTimeout(() => {
    const targetNode = lavalinkManager.nodeManager.get(nodeId);
    if (!targetNode) {
      console.error(
        `❌ Nodo ${nodeId}: no se encontró el nodo en nodeManager para reconectar.`
      );
      return;
    }
    try {
      console.log(`🔌 Nodo ${nodeId}: reconectando WebSocket...`);
      targetNode.connect();
    } catch (err) {
      console.error(`Error reconectando nodo ${nodeId}:`, err);
      scheduleReconnect(targetNode);
    }
  }, delay);

  reconnectState.set(nodeId, { attempts, timer });
}

lavalinkManager.nodeManager.on("connect", (node) => {
  console.log(`✅ Nodo Lavalink conectado: ${node.id}`);
});

lavalinkManager.nodeManager.on("disconnect", (node, reason) => {
  console.log(
    `Nodo Lavalink desconectado: ${node.id} - ${reason.reason || reason}`
  );
});

lavalinkManager.nodeManager.on("ready", (node) => {
  console.log(`Nodo ${node.id} está listo (WebSocket abierto).`);

  const state = reconnectState.get(node.id);
  if (state?.timer) clearTimeout(state.timer);
  reconnectState.delete(node.id);
});

lavalinkManager.nodeManager.on("error", (node, error) => {
  console.error(`Error en el nodo ${node.id}:`, error?.message || error);
});

lavalinkManager.nodeManager.on("close", (node, code, reason) => {
  console.warn(
    `🔌 WebSocket cerrado para nodo ${node.id} (code=${code}, reason=${reason})`
  );
  scheduleReconnect(node);
});

lavalinkManager.nodeManager.on("reconnecting", (node) => {
  console.warn(`Nodo ${node.id} intentando reconectar (evento reconnecting).`);
});

//
// --- UTILIDADES PARA /cola (PAGINACIÓN) ---
//
const QUEUE_PAGE_SIZE = 10;

function buildQueuePage(player, page, userId) {
  const totalTracks = player.queue.tracks.length;
  const totalPages = Math.max(1, Math.ceil(totalTracks / QUEUE_PAGE_SIZE));

  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * QUEUE_PAGE_SIZE;
  const end = start + QUEUE_PAGE_SIZE;

  const slice = player.queue.tracks.slice(start, end);

  const description =
    slice
      .map(
        (t, i) =>
          `${start + i + 1}. **${t.info.title}** — ${t.info.author || "Desconocido"}`
      )
      .join("\n") || "La cola está vacía.";

  const embed = new EmbedBuilder()
    .setTitle("📜 Cola de reproducción")
    .setDescription(description)
    .setColor("Green")
    .setFooter({
      text: `Página ${currentPage}/${totalPages} • Total: ${totalTracks} canciones`,
    });

  const row = new ActionRowBuilder();

  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(
        `queue:prev:${player.guildId}:${userId}:${currentPage - 1}`
      )
      .setLabel("⬅️Anterior")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasPrev),
    new ButtonBuilder()
      .setCustomId(
        `queue:next:${player.guildId}:${userId}:${currentPage + 1}`
      )
      .setLabel("Siguiente➡️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasNext)
  );

  return {
    embed,
    components: [row],
  };
}

//
// --- SHUFFLE SEGURO ---
//
function shuffleSeguro(queue) {
  if (!queue?.tracks || queue.tracks.length < 2) return;

  const before = queue.tracks.length;

  const shuffled = [...queue.tracks];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  queue.tracks = shuffled;

  const after = queue.tracks.length;
  console.log(
    `🔀 shuffleSeguro: antes=${before}, después=${after}${
      before !== after ? "TAMAÑO CAMBIÓ" : ""
    }`
  );
}

//
// --- EVENTOS DE REPRODUCCIÓN ---
//
lavalinkManager.on("trackStart", (player, track) => {
  const channel = client.channels.cache.get(player.textChannelId);
  if (!channel) return;

  const platform =
    track.info.sourceName ||
    (track.info.uri?.includes("youtube")
      ? "YouTube"
      : track.info.uri?.includes("youtu.be")
      ? "YouTube"
      : "Desconocida");

  console.log(
    `🎵 ${client.user.username} reproduce: "${track.info.title}" de ${track.info.author} | Plataforma: ${platform}`
  );

  const guildId = player.guildId;
  if (!trackStats.has(guildId)) {
    trackStats.set(guildId, new Map());
  }
  const guildStats = trackStats.get(guildId);
  guildStats.set(
    track.info.title,
    (guildStats.get(track.info.title) || 0) + 1
  );

  const embed = new EmbedBuilder()
    .setTitle("🎶 Reproduciendo ahora")
    .setDescription(
      `**${track.info.title}**\n👤 Por: ${track.info.author}\n⏱️ Duración: ${Math.floor(
        track.info.duration / 60000
      )}:${Math.floor((track.info.duration % 60000) / 1000)
        .toString()
        .padStart(2, "0")}`
    )
    .setColor("Purple");

  if (track.info.artworkUrl) {
    embed.setThumbnail(track.info.artworkUrl);
  }

  channel.send({
    embeds: [embed],
    components: [buildControlRow()],
  });
});

lavalinkManager.on("queueEnd", (player) => {
  const channel = client.channels.cache.get(player.textChannelId);
  if (channel) {
    channel.send("Cola finalizada. Usa `/reproducete` para más música.");
  }
});

client.once("ready", () => {
  console.log(`Logueado como ${client.user.tag}`);
  lavalinkManager.init({ id: client.user.id, username: client.user.username });
});

client.on("raw", (d) => lavalinkManager.sendRawData(d));

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId.startsWith("queue:")) {
      const [, action, guildId, ownerId, pageStr] =
        interaction.customId.split(":");
      const page = parseInt(pageStr, 10) || 1;

      if (interaction.user.id !== ownerId) {
        return interaction.reply({
          content: "Solo la persona que ejecutó `/cola` puede usar estos botones.",
          ephemeral: true,
        });
      }

      const player = lavalinkManager.getPlayer(guildId);
      if (!player || !player.queue.tracks.length) {
        return interaction.update({
          content: "📜La cola está vacía.",
          embeds: [],
          components: [],
        });
      }

      const { embed, components } = buildQueuePage(player, page, ownerId);
      return interaction.update({
        embeds: [embed],
        components,
      });
    }

    const player = lavalinkManager.getPlayer(interaction.guildId);
    if (!player) {
      return interaction.reply({
        content: "No hay música reproduciéndose.",
        ephemeral: true,
      });
    }

    switch (interaction.customId) {
      case "player:pause":
        await player.pause();
        return interaction.reply({
          content: "⏸️ Música pausada.",
          ephemeral: true,
        });
      case "player:resume":
        await player.resume();
        return interaction.reply({
          content: "▶️ Música reanudada.",
          ephemeral: true,
        });
      case "player:skip":
        await player.skip();
        return interaction.reply({
          content: "⏭️ Canción saltada.",
          ephemeral: true,
        });
      case "player:shuffle":
        if (player.queue.tracks.length < 2) {
          return interaction.reply({
            content: "No hay suficientes canciones para mezclar.",
            ephemeral: true,
          });
        }
        shuffleSeguro(player.queue);
        return interaction.reply({
          content: "Cola mezclada.",
          ephemeral: true,
        });
      case "player:stop":
        await player.destroy();
        return interaction.reply({
          content: "Música detenida.",
          ephemeral: true,
        });
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const command = interaction.commandName;

  if (command === "reproducete") {
    const query = interaction.options.getString("cancion");
    const member = interaction.guild.members.cache.get(interaction.user.id);
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: "Debes estar en un canal de voz.",
        ephemeral: true,
      });
    }

    const perms = voiceChannel.permissionsFor(interaction.guild.members.me);
    if (
      !perms?.has([
        PermissionsBitField.Flags.Connect,
        PermissionsBitField.Flags.Speak,
      ])
    ) {
      return interaction.reply({
        content: "Me faltan permisos de Conectar y Hablar.",
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      let player = lavalinkManager.getPlayer(interaction.guildId);

      if (!player) {
        player = lavalinkManager.createPlayer({
          guildId: interaction.guildId,
          voiceChannelId: voiceChannel.id,
          textChannelId: interaction.channelId,
          selfDeaf: true,
          volume: 50,
        });

        await player.connect();
      }

      const isUrl = /^https?:\/\//i.test(query);

      const searchQuery = isUrl
        ? { query }
        : { query, source: "ytsearch" };

      const res = await player.search(searchQuery, interaction.user);

      if (!res.tracks.length) {
        return interaction.editReply("No se encontró la canción o playlist.");
      }

      let addedCount = 0;

      if (res.loadType === "playlist" || res.loadType === "searchResult") {
        await player.queue.add(res.tracks);
        addedCount = res.tracks.length;
      } else {
        await player.queue.add(res.tracks[0]);
        addedCount = 1;
      }

      if (!player.playing && !player.paused) {
        await player.play();
      }

      if (addedCount === 1) {
        return interaction.editReply(
          `✅ **${res.tracks[0].info.title}** añadida a la cola.`
        );
      } else {
        const playlistName =
          res.playlist?.name || res.tracks[0]?.info?.title || "playlist";
        return interaction.editReply(
          `✅ Se añadieron **${addedCount}** pistas de **${playlistName}** a la cola.`
        );
      }
    } catch (e) {
      console.error("Error:", e);
      return interaction.editReply(`❌ Error: ${e.message}`);
    }
  }

  if (command === "saltar") {
    const player = lavalinkManager.getPlayer(interaction.guildId);
    if (!player || !player.queue.current) {
      return interaction.reply({
        content: "No hay nada sonando.",
        ephemeral: true,
      });
    }

    const posicion = interaction.options.getInteger("posicion");
    if (posicion) {
      if (posicion < 1 || posicion > player.queue.tracks.length) {
        return interaction.reply({
          content: `La cola solo tiene ${player.queue.tracks.length} canciones.`,
          ephemeral: true,
        });
      }
      player.queue.splice(0, posicion - 1);
    }

    await player.skip();
    return interaction.reply("⏭️ Canción saltada.");
  }

  if (command === "detener") {
    const player = lavalinkManager.getPlayer(interaction.guildId);
    if (!player) {
      return interaction.reply({
        content: "No estoy conectado.",
        ephemeral: true,
      });
    }
    await player.destroy();
    return interaction.reply("🛑 Música detenida.");
  }

  if (command === "cola") {
    const player = lavalinkManager.getPlayer(interaction.guildId);
    if (!player || !player.queue.tracks.length) {
      return interaction.reply({
        content: "📜 La cola está vacía.",
        ephemeral: true,
      });
    }

    const pageOption = interaction.options.getInteger("pagina") || 1;

    const { embed, components } = buildQueuePage(
      player,
      pageOption,
      interaction.user.id
    );

    return interaction.reply({
      embeds: [embed],
      components,
    });
  }

  if (command === "eliminar") {
    const player = lavalinkManager.getPlayer(interaction.guildId);
    if (!player || !player.queue.tracks.length) {
      return interaction.reply({
        content: "No hay canciones en la cola.",
        ephemeral: true,
      });
    }

    const posicion = interaction.options.getInteger("posicion");
    if (posicion < 1 || posicion > player.queue.tracks.length) {
      return interaction.reply({
        content: `Ingresa un número entre 1 y ${player.queue.tracks.length}.`,
        ephemeral: true,
      });
    }

    const trackToRemove = player.queue.tracks[posicion - 1];
    player.queue.splice(posicion - 1, 1);

    return interaction.reply(
      `🗑️ **${trackToRemove.info.title}** fue eliminada de la cola.`
    );
  }

  if (command === "pausar") {
    const player = lavalinkManager.getPlayer(interaction.guildId);
    if (!player || player.paused) {
      return interaction.reply({
        content: "❌ No hay música o ya está pausada.",
        ephemeral: true,
      });
    }
    await player.pause();
    return interaction.reply("⏸️ Música pausada.");
  }

  if (command === "reanudar") {
    const player = lavalinkManager.getPlayer(interaction.guildId);
    if (!player || !player.paused) {
      return interaction.reply({
        content: "❌ No hay música o ya está sonando.",
        ephemeral: true,
      });
    }
    await player.resume();
    return interaction.reply("▶️ Música reanudada.");
  }

  if (command === "ahora") {
    const player = lavalinkManager.getPlayer(interaction.guildId);
    if (!player || !player.queue.current) {
      return interaction.reply({
        content: "❌ No hay nada sonando.",
        ephemeral: true,
      });
    }

    const track = player.queue.current;
    const embed = new EmbedBuilder()
      .setTitle("🎵 Reproduciendo Ahora")
      .setDescription(`**${track.info.title}**\n👤 Por: ${track.info.author}`)
      .setColor("Blue");

    if (track.info.artworkUrl) {
      embed.setThumbnail(track.info.artworkUrl);
    }

    return interaction.reply({ embeds: [embed] });
  }

  if (command === "limpiar") {
    const player = lavalinkManager.getPlayer(interaction.guildId);
    if (!player || !player.queue.tracks.length) {
      return interaction.reply({
        content: "❌ La cola ya está vacía.",
        ephemeral: true,
      });
    }
    player.queue.clear();
    return interaction.reply("Cola limpia.");
  }

  if (command === "mezclar") {
    const player = lavalinkManager.getPlayer(interaction.guildId);
    if (!player || player.queue.tracks.length < 2) {
      return interaction.reply({
        content: "No hay suficientes canciones.",
        ephemeral: true,
      });
    }

    const before = player.queue.tracks.length;
    shuffleSeguro(player.queue);
    const after = player.queue.tracks.length;

    console.log(
      `🔀 /mezclar guild=${interaction.guildId} antes=${before}, después=${after}`
    );

    return interaction.reply("🔀 Cola mezclada.");
  }

  if (command === "loop") {
    const player = lavalinkManager.getPlayer(interaction.guildId);
    if (!player) {
      return interaction.reply({
        content: "No hay música.",
        ephemeral: true,
      });
    }

    const modo = interaction.options.getString("modo");
    if (modo === "track") {
      player.setRepeatMode("track");
      return interaction.reply("🔂 Repitiendo canción.");
    } else if (modo === "queue") {
      player.setRepeatMode("queue");
      return interaction.reply("🔁 Repitiendo cola.");
    } else {
      player.setRepeatMode("off");
      return interaction.reply("➡️ Repetición desactivada.");
    }
  }

  if (command === "top") {
    const guildStats = trackStats.get(interaction.guildId);
    if (!guildStats || guildStats.size === 0) {
      return interaction.reply({
        content: "Aún no hay estadísticas.",
        ephemeral: true,
      });
    }

    const listado = Array.from(guildStats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(
        (entry, i) =>
          `${i + 1}. **${entry[0]}** — ${entry[1]} reproducciones`
      )
      .join("\n");

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🏆 Top canciones")
          .setDescription(listado)
          .setColor("Gold"),
      ],
    });
  }
});

//
// --- AVISAR EN EL CANAL CUANDO SACAN AL BOT DEL VOZ ---
//
client.on("voiceStateUpdate", async (oldState, newState) => {
  if (!client.user || newState.id !== client.user.id) return;

  const guildId = newState.guild.id;
  const player = lavalinkManager.getPlayer(guildId);
  if (!player) return;

  const oldChannelId = oldState.channelId;
  const newChannelId = newState.channelId;

  // Se desconectó del canal de voz
  if (oldChannelId && !newChannelId) {
    const textChannel = client.channels.cache.get(player.textChannelId);
    if (textChannel && textChannel.isTextBased()) {
      await textChannel.send("Me sacaron del canal de voz, así que la buena, nos pillamos luego. 👋");
    }
    await player.destroy();
    return;
  }

  // Lo movieron a otro canal de voz
  if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
    const textChannel = client.channels.cache.get(player.textChannelId);
    if (textChannel && textChannel.isTextBased()) {
      await textChannel.send("Me movieron de canal de voz, así que paré la música por si acaso aguevao. 🤨");
    }
  }
});

client.login(process.env.DISCORD_TOKEN);