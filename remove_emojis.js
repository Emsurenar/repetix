const fs = require('fs');

const removeEmojis = (file) => {
    let content = fs.readFileSync(file, 'utf8');
    const emojiRegex = /[\u{1F300}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{1F201}-\u{1F251}\u{2B50}\u{231A}\u{231B}\u{23E9}-\u{23EC}\u{23F0}\u{23F3}\u{25FD}\u{25FE}\u{25AB}\u{25AA}\u{2B1B}\u{2B1C}\u{1F004}\u{1F0CF}\u{1F191}-\u{1F19A}️]/gu;
    const specific = /✨|⬆|⬇|🎉|📓|🔄|🧠|🧪|🎯|📋|📝|🗑/g;
    content = content.replace(emojiRegex, '').replace(specific, '');
    fs.writeFileSync(file, content);
};

removeEmojis('index.html');
removeEmojis('script.js');
console.log('Emojis removed');
