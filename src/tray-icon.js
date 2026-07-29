const { nativeImage } = require('electron');

// Simple triangle icon for the menu bar - black/white template style
// This is a 22x22px icon that works as a template image on macOS
// The triangle points upward, simple and clean like native macOS icons
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5 L16 11 L6 17 Z"/></svg>`;

function createTrayIcon() {
  try {
    // Create icon from SVG data URL
    const icon = nativeImage.createFromDataURL(
      'data:image/svg+xml;base64,' + Buffer.from(ICON_SVG).toString('base64')
    );
    // Set as template image so macOS renders it in the correct color
    // (white in dark menu bar, black in light)
    try { icon.setTemplateImage(true); } catch (e) {}
    return icon;
  } catch (e) {
    console.error('[tray-icon] Error creating icon:', e.message);
    return nativeImage.createEmpty();
  }
}

module.exports = { createTrayIcon };