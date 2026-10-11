const auth = require('@react-native-firebase/auth');
console.log("AUTH EXPORTS:", Object.keys(auth));
console.log("AUTH DEFAULT:", typeof auth.default);
const firestore = require('@react-native-firebase/firestore');
console.log("FIRESTORE EXPORTS:", Object.keys(firestore));
console.log("FIRESTORE DEFAULT:", typeof firestore.default);
