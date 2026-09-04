import { Canvas, Fill } from '@shopify/react-native-skia'
import { useFonts } from 'expo-font'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View } from 'react-native'
import { cellToLatLng } from 'react-native-nitro-h3'
import { fontAssets } from './theme/fonts'
import { colours, type } from './theme/tokens'

const SAMPLE_CELL = 0x8928308280fffffn

export default function App() {
  const [fontsLoaded] = useFonts(fontAssets)
  const { lat, lng } = cellToLatLng(SAMPLE_CELL)

  // the ground colour already fills the window, so an unstyled first frame is worse than none
  if (!fontsLoaded) return <View style={styles.root} />

  return (
    <View style={styles.root}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill color={colours.ground} />
      </Canvas>
      <View style={styles.readout} pointerEvents="none">
        <Text style={styles.label}>cellToLatLng</Text>
        <Text style={styles.cell}>0x{SAMPLE_CELL.toString(16)}</Text>
        <Text style={styles.metric}>
          {lat.toFixed(6)}, {lng.toFixed(6)}
        </Text>
      </View>
      <StatusBar style="light" />
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colours.ground,
  },
  readout: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: {
    ...type.label,
    color: colours.muted,
  },
  cell: {
    ...type.value,
    color: colours.text,
  },
  metric: {
    ...type.metric,
    color: colours.text,
  },
})
