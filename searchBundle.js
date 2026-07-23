const fs = require('fs');
const bundle = fs.readFileSync('C:\\Users\\bestl\\VERTEX\\final-app\\deliverasnow_apk\\assets\\index.android.bundle', 'utf8');

const searchTerms = ['BackgroundActions', 'BackgroundService', 'react-native-background-actions', 'RNBackgroundActions'];
for (const term of searchTerms) {
    const regex = new RegExp(`.{0,150}${term}.{0,150}`, 'gi');
    let match;
    console.log(`\n--- Matches for ${term} ---`);
    let count = 0;
    while ((match = regex.exec(bundle)) !== null && count < 5) {
        console.log(match[0]);
        count++;
    }
}
