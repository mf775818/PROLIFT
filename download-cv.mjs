import fs from 'fs';
import https from 'https';
import path from 'path';

const dir = path.join(process.cwd(), 'public', 'js');
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

const dest = path.join(dir, 'opencv.js');
console.log('Downloading opencv.js 4.8.0 to', dest);

const file = fs.createWriteStream(dest);
https.get("https://docs.opencv.org/4.8.0/opencv.js", function(response) {
  if (response.statusCode !== 200) {
      console.error('Error downloading: Status Code', response.statusCode);
      return;
  }
  response.pipe(file);
  file.on('finish', () => {
    file.close();
    console.log('Download completed');
  });
}).on('error', (err) => {
  fs.unlink(dest, () => {});
  console.error('Error downloading:', err.message);
});
