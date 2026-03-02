const expectedRegions = [
  'telaviv',
  'beersheva',
  'haifa',
  'jerusalem',
  'nathanya',
  'rishonlezion',
  'bikatpetah',
  'hodhasharon',
  'herzliyaramathas',
  'rehovot',
  'krayot',
  'ashdod',
  'ramlelod',
  'hadera',
  'eilat',
  'modiin',
  'ashkelon',
  'shoham',
  'yokneam'
];

const fs = require('fs');
const configContent = fs.readFileSync('./js/config.js', 'utf8');
const regionsMatch = configContent.match(/name: '([^']+)'/g);
const actualRegions = regionsMatch.map(m => m.match(/name: '([^']+)'/)[1]);

console.log('Expected regions:', expectedRegions.length);
console.log('Actual regions:', actualRegions.length);
console.log('\nVerification:');

let allMatch = true;
expectedRegions.forEach((expected, i) => {
  const actual = actualRegions[i];
  const match = expected === actual;
  if (!match) {
    console.log(`❌ Mismatch at index ${i}: expected "${expected}", got "${actual}"`);
    allMatch = false;
  }
});

if (allMatch && expectedRegions.length === actualRegions.length) {
  console.log('✅ All region names match exactly!');
} else {
  console.log('\n❌ Mismatches found');
}
