/** The URL of the packed hand-made models file (scripts/vite-models.ts). */
declare module 'virtual:citybloom-models' {
  const url: string;
  export default url;
}

/** The URL of the war models file (phase 5; scripts/vite-models.ts), fetched only in a city with war on. */
declare module 'virtual:citybloom-war-models' {
  const url: string;
  export default url;
}
