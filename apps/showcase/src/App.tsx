import { Canvas, Fill } from '@shopify/react-native-skia'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View } from 'react-native'
import { cellToLatLng } from 'react-native-nitro-h3'

const GROUND = '#060911'
const SAMPLE_CELL = 0x8928308280fffffn

export default function App() {
  const { lat, lng } = cellToLatLng(SAMPLE_CELL)

  return (
    <View style={styles.root}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill color={GROUND} />
      </Canvas>
      <View style={styles.readout} pointerEvents="none">
        <Text style={styles.label}>cellToLatLng</Text>
        <Text style={styles.cell}>0x{SAMPLE_CELL.toString(16)}</Text>
        <Text style={styles.value}>
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
    backgroundColor: GROUND,
  },
  readout: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: {
    color: '#4d6f9a',
    fontSize: 13,
  },
  cell: {
    color: '#9fc4ea',
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
  value: {
    color: '#e8f3ff',
    fontSize: 28,
    fontVariant: ['tabular-nums'],
  },
})
