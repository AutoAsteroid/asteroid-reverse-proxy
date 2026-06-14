
/**
 * This is a mapping from Minecraft bedrock text colors to their respective colors for discord
 * Used to color discord embeds! This is equivalent to using §# in Minecraft for colors
 */
const DISCORD_COLORS = {
    // black       dark_blue      dark_green     dark_aqua      dark_red       dark_purple
    '0': 0,        '1': 170,      '2': 43520,    '3': 43690,    '4': 11141120, '5': 11141290,
    // gold        gray           dark_gray      blue           green          aqua
    '6': 16755200, '7': 11184810, '8': 5592405,  '9': 5592575,  'a': 5635925,  'b': 5636095, 
    // red         light_purple   yellow         white          minecoin_gold  quartz
    'c': 16733525, 'd': 16733695, 'e': 16777045, 'f': 16777215, 'g': 14598533, 'h': 14991505,
    // iron        netherite      redstone       copper         material_gold  emerald
    'i': 13553354, 'j': 4484667,  'm': 9892103,  'n': 11862221, 'p': 14623469, 'q': 4703718,
    // diamond     lapis          amethyst
    's': 2938536,  't': 2186619,  'u': 10117606,
};

module.exports = { DISCORD_COLORS };