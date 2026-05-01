import { ModelSceneContent } from '../scene/ModelSceneContent'
import { SCENE_VP } from '../scene/sceneConstants'
import type { MpdCurtainState } from './useMpdCurtain'

interface MpdCurtainSceneProps {
  curtain: MpdCurtainState
}

export function MpdCurtainScene({ curtain }: MpdCurtainSceneProps) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      clipPath: curtain.direction === 'left'
        ? `inset(0 ${curtain.progress * 100}% 0 0)`
        : `inset(0 0 0 ${curtain.progress * 100}%)`,
    }}>
      {/* Old background — always render to prevent new bg bleeding through */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          ...(curtain.oldBgConfig?.type === 'image' && curtain.oldBgConfig.value
            ? {
                backgroundImage: `url(${curtain.oldBgConfig.value})`,
                backgroundSize: curtain.oldBgConfig.fit === 'tile' ? 'auto' : (curtain.oldBgConfig.fit ?? 'cover'),
                backgroundPosition: 'center',
                backgroundRepeat: curtain.oldBgConfig.fit === 'tile' ? 'repeat' : 'no-repeat',
                opacity: curtain.oldBgConfig.opacity ?? 1,
                filter: curtain.oldBgConfig.blur ? `blur(${curtain.oldBgConfig.blur}px)` : undefined,
              }
            : curtain.oldBgStyle
              ? curtain.oldBgStyle
              : { background: 'var(--ug-viewport-bg)' }),
        }}
      />
      {/* Old particles — frozen screenshot from transition start */}
      {curtain.particleScreenshot && (
        <img
          src={curtain.particleScreenshot}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        />
      )}
      <div
        className="scene"
        style={curtain.oldSceneStyle}
      >
        {/* Old grid */}
        <div style={{
          position: 'absolute',
          left: `${curtain.oldGridExtent.minX}%`,
          top: `${curtain.oldGridExtent.minY}%`,
          width: `${curtain.oldGridExtent.maxX - curtain.oldGridExtent.minX}%`,
          height: `${curtain.oldGridExtent.maxY - curtain.oldGridExtent.minY}%`,
          backgroundImage: curtain.oldGridBgImage,
          backgroundSize: `${curtain.oldGridPxW}px ${curtain.oldGridPxH}px`,
          pointerEvents: 'none',
        }} />
        <ModelSceneContent
          model={curtain.oldModel}
          selectedNodeId={null}
          childModel={undefined}
          progress={0}
          vpSize={SCENE_VP}
          onSelectNode={() => {}}
          onDoubleClickNode={() => {}}
          onClickConnection={() => {}}
          onNodeDragStart={() => {}}
          onConnectionDragStart={() => {}}
          draggingNodeId={null}
          editingNodeId={null}
          onFinishEditing={() => {}}
          onLiveEditLabel={() => {}}
          connectionDraft={null}
          flowAnimations={new Map()}
          emergeAnimations={new Map()}
          flowActiveNodes={new Set()}
          unzipGap={null}
          noTransition
          initialNodeSizes={curtain.oldNodeSizes}
        />
      </div>
    </div>
  )
}
