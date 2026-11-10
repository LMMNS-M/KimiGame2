// The page and assets can live on GitHub Pages; scores stay on Ubuntu.
// Local previews use their own server. The production URL is HTTPS.
export const API_BASE_URL = location.hostname.endsWith('.github.io')
  ? 'https://lammens-cloud.tail538586.ts.net'
  : '';
