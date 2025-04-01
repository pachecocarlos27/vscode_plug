const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

async function resizeImage(inputPath, outputPath, width, height) {
  try {
    // Load the image
    const image = await loadImage(inputPath);
    
    // Create a canvas with the desired dimensions
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Draw the image on the canvas
    ctx.drawImage(image, 0, 0, width, height);
    
    // Write the canvas to a PNG file
    const out = fs.createWriteStream(outputPath);
    const stream = canvas.createPNGStream();
    stream.pipe(out);
    
    return new Promise((resolve, reject) => {
      out.on('finish', () => {
        console.log(`Resized image saved to ${outputPath}`);
        resolve();
      });
      out.on('error', reject);
    });
  } catch (error) {
    console.error(`Error resizing image: ${error.message}`);
    throw error;
  }
}

async function main() {
  const logoPath = path.join(__dirname, 'logo.png');
  const iconDir = path.join(__dirname, 'icons');
  
  // Ensure icons directory exists
  if (!fs.existsSync(iconDir)) {
    fs.mkdirSync(iconDir);
  }
  
  // Create resized versions
  try {
    await resizeImage(logoPath, path.join(iconDir, 'icon-256.png'), 256, 256);
    await resizeImage(logoPath, path.join(iconDir, 'icon-128.png'), 128, 128);
    await resizeImage(logoPath, path.join(iconDir, 'icon-64.png'), 64, 64);
    await resizeImage(logoPath, path.join(iconDir, 'icon-32.png'), 32, 32);
    console.log('All icons resized successfully');
  } catch (error) {
    console.error('Failed to resize icons:', error);
  }
}

main();