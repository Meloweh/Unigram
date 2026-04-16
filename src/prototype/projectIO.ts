import type { Model, ThemeMode, ModelCosmetics } from './sampleModels'
import { exportBundle, importBundle, clearLoaderCache, registerModelUrl } from './modelLoader'

export async function handleSave(
  storeModels: Record<string, Model>,
  modelCosmetics: Record<string, ModelCosmetics>,
  appThemeMode: ThemeMode,
) {
  const blob = await exportBundle(storeModels, modelCosmetics, appThemeMode)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'unigram-project.unigram'
  a.click()
  URL.revokeObjectURL(url)
}

export function handleLoad(
  e: React.ChangeEvent<HTMLInputElement>,
  deps: {
    registerModel: (model: Model) => void
    resetToRoot: () => void
    setAppThemeMode: (mode: ThemeMode) => void
    setModelCosmetics: (modelId: string, cos: ModelCosmetics) => void
  },
) {
  const file = e.target.files?.[0]
  if (!file) return

  const { registerModel, resetToRoot, setAppThemeMode, setModelCosmetics } = deps

  if (file.name.endsWith('.unigram') || file.name.endsWith('.zip')) {
    // Bundle format
    importBundle(file, registerModel, resetToRoot, (settings) => {
      if (settings.appThemeMode) setAppThemeMode(settings.appThemeMode)
      if (settings.modelCosmetics) {
        for (const [modelId, cos] of Object.entries(settings.modelCosmetics)) {
          setModelCosmetics(modelId, cos)
        }
      }
    }).catch((err) => {
      console.error('Failed to load bundle:', err)
    })
  } else {
    // Legacy JSON format
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string)
        clearLoaderCache()
        const basePath = '/models/'
        for (const [filename, fileData] of Object.entries(data)) {
          const modelFile = fileData as { id: string }
          registerModelUrl(modelFile.id, basePath + filename)
        }
        for (const [, fileData] of Object.entries(data)) {
          const mf = fileData as {
            id: string; label: string
            nodes: { id: string; label: string; x: number; y: number; childModel?: string; mpdModels?: string[] }[]
            connections: { from: string; to: string; evidence?: { title: string; citation: string; url: string }[] }[]
          }
          const idLookup = new Map<string, string>()
          for (const [fn, fd] of Object.entries(data)) {
            const m = fd as { id: string }
            idLookup.set('./' + fn, m.id)
            idLookup.set(fn, m.id)
          }
          registerModel({
            id: mf.id,
            label: mf.label,
            nodes: mf.nodes.map((n) => ({
              id: n.id, label: n.label, x: n.x, y: n.y,
              childModelId: n.childModel ? idLookup.get(n.childModel) : undefined,
              mpdIds: n.mpdModels?.length
                ? n.mpdModels.map((p) => idLookup.get(p)).filter(Boolean) as string[]
                : undefined,
            })),
            connections: mf.connections,
          })
        }
        resetToRoot()
      } catch (err) {
        console.error('Failed to load project file:', err)
      }
    }
    reader.readAsText(file)
  }
  e.target.value = ''
}
