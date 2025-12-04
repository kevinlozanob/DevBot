require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('reproducete')
        .setDescription('Reproduce una canción o playlist (SoundCloud).')
        .addStringOption(option =>
            option.setName('cancion')
                .setDescription('Nombre o URL de la canción.')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('saltar')
        .setDescription('Salta la canción actual o a una posición específica.')
        .addIntegerOption(option =>
            option.setName('posicion')
                .setDescription('Número de la canción en la cola')
                .setRequired(false)
                .setMinValue(1)
        ),

    new SlashCommandBuilder()
        .setName('detener')
        .setDescription('Detiene la música y borra la cola.'),

    new SlashCommandBuilder()
        .setName('cola')
        .setDescription('Muestra la lista de reproducción.'),

    new SlashCommandBuilder()
        .setName('eliminar')
        .setDescription('Elimina una canción específica de la cola.')
        .addIntegerOption(option =>
            option.setName('posicion')
                .setDescription('Número mostrado en /cola')
                .setRequired(true)
                .setMinValue(1)
        ),

    new SlashCommandBuilder()
        .setName('pausar')
        .setDescription('Pausa la música actual.'),

    new SlashCommandBuilder()
        .setName('reanudar')
        .setDescription('Reanuda la música pausada.'),

    new SlashCommandBuilder()
        .setName('ahora')
        .setDescription('Muestra la canción que está sonando.'),

    new SlashCommandBuilder()
        .setName('limpiar')
        .setDescription('Vacía la cola sin detener la canción actual.'),

    new SlashCommandBuilder()
        .setName('mezclar')
        .setDescription('Baraja aleatoriamente la cola.'),

    new SlashCommandBuilder()
        .setName('loop')
        .setDescription('Configura el modo de repetición.')
        .addStringOption(option =>
            option.setName('modo')
                .setDescription('Modo de repetición')
                .setRequired(true)
                .addChoices(
                    { name: 'Canción actual', value: 'track' },
                    { name: 'Toda la cola', value: 'queue' },
                    { name: 'Desactivar', value: 'off' }
                )
        ),

    new SlashCommandBuilder()
        .setName('top')
        .setDescription('Muestra las canciones más reproducidas del servidor.')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('🔄 Actualizando lista de comandos en Discord...');

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );

        console.log('✅ ¡Comandos registrados!');
    } catch (error) {
        console.error(error);
    }
})();