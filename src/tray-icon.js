const { nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// Load the bundled triangle PNG as a macOS template image.
// Template images render in the correct color (white in dark menu bar,
// black in light) automatically based on the menu bar theme.
function createTrayIcon() {
  try {
    const iconPath = path.join(__dirname, 'tray-icon.png');
    if (!fs.existsSync(iconPath)) {
      console.error('[tray-icon] tray-icon.png not found at', iconPath);
      return nativeImage.createEmpty();
    }

    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      console.error('[tray-icon] Failed to load tray-icon.png');
      return nativeImage.createEmpty();
    }

    // Set as template image for native macOS menu bar rendering
    try { icon.setTemplateImage(true); } catch (e) {}
    return icon;
  } catch (e) {
    console.error('[tray-icon] Error creating icon:', e.message);
    return nativeImage.createEmpty();
  }
}

module.exports = { createTrayIcon };