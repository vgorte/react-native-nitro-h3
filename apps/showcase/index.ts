// first, so the cell ceiling is set before any module the app pulls in can reach the package
import './src/configureH3'

import { registerRootComponent } from 'expo'

import App from './src/App'

registerRootComponent(App)
