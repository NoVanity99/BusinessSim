/** World art colours. Change these (or replace the draw functions) to restyle the game. */
export const WORLD = {
  grass: '#5d9a52',
  grassDark: '#548c4a',
  park: '#6bab5c',
  tree: '#3f7a3c',
  treeLight: '#4f9148',
  trunkShadow: 'rgba(0,0,0,0.18)',
  road: '#3b4049',
  roadLine: '#d9c36a',
  sidewalk: '#b9bcc2',
  sidewalkLine: '#a5a8ae',
  crosswalk: '#e9eaec',
  lot: '#c9b79a',
  lotLine: '#b8a585',
  path: '#d6c9a8',
  sand: '#e6d49c',
  water: '#4a90c2',
  waterLight: '#63a6d6',
  shadow: 'rgba(0,0,0,0.22)',
};

/** Roof colour sets per neighbourhood building style: [roof, roofDark, detail]. */
export const ROOFS: Record<string, string[][]> = {
  office: [['#6f86a6', '#5c7190', '#9fd0f0'], ['#7d8fa3', '#687a8d', '#b5dcf2'], ['#5f6f8c', '#4f5d77', '#8fc3e8'], ['#8795a8', '#727f91', '#c5e3f4']],
  brick: [['#a8614b', '#8f503d', '#e2c9a1'], ['#b5744f', '#9a6040', '#ead7b4'], ['#96584a', '#7e493d', '#d9bf9b'], ['#a36a55', '#8a5846', '#e6d0ad']],
  house: [['#b5674d', '#9b5640', '#f1e3c6'], ['#7c8f6a', '#687a58', '#f1e3c6'], ['#8a7aa0', '#756689', '#f1e3c6'], ['#c08d52', '#a67843', '#f1e3c6']],
  warehouse: [['#8b9099', '#777c85', '#5c6068'], ['#9a938a', '#857e76', '#69635c'], ['#7f8a8f', '#6c767b', '#565f63'], ['#948b7d', '#7f776a', '#655e53']],
  resort: [['#e9dcc0', '#d3c5a6', '#5fb8c9'], ['#f0c9a0', '#dab387', '#e2725b'], ['#d7e6e2', '#bfd0cb', '#4aa3a0'], ['#f3e2b8', '#decb9d', '#e8914f']],
};
