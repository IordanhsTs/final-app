import { registerRootComponent } from 'expo';

// Το Background Task ΠΡΕΠΕΙ να γίνεται import στο κεντρικό αρχείο (global scope)
import './src/services/backgroundTasks';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
