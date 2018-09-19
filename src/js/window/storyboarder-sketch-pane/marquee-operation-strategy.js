const SketchPaneUtil = require('alchemancy').util

class MarqueeOperationStrategy {
  constructor (context) {
    this.context = context
    this.name = 'marqueeOperation'

    this.layer = this.context.sketchPane.layers.findByName('composite')

    this._onPointerDown = this._onPointerDown.bind(this)
    this._onPointerMove = this._onPointerMove.bind(this)
    this._onPointerUp = this._onPointerUp.bind(this)
    this._onKeyDown = this._onKeyDown.bind(this)
  }

  startup () {
    console.log('MarqueeOperationStrategy#startup')

    this.context.store.dispatch({ type: 'TOOLBAR_MODE_STATUS_SET', payload: 'busy', meta: { scope: 'local' } })

    this.state = {
      marqueePath: this.context.marqueePath.clone(),
      done: false
    }

    this.context.sketchPane.selectedArea.set(this.state.marqueePath)
    this.context.sketchPane.selectedArea.target = {
      x: this.state.marqueePath.bounds.x,
      y: this.state.marqueePath.bounds.y
    }

    // delete ALL cached canvas textures to ensure canvas is re-rendered
    PIXI.utils.clearTextureCache()

    this.outlineSprite = this.context.sketchPane.selectedArea.asOutlineSprite()
    this.cutSprite = this.context.sketchPane.selectedArea.asSprite(this.context.visibleLayersIndices)

    // TODO should this move to a SelectedArea setup/prepare method?

    // solid background
    this.bgGraphics = new PIXI.Graphics()
    this.bgGraphics.beginFill(0xffffff)
    // draw a rectangle
    this.bgGraphics.drawRect(0, 0, this.context.sketchPane.width, this.context.sketchPane.height)
    this.layer.sprite.addChild(this.bgGraphics)

    let maskSprite = this.context.sketchPane.selectedArea.asMaskSprite(true)
    this.flattenedLayerSprite = new PIXI.Sprite(
      PIXI.Texture.fromCanvas(
        this.context.sketchPane.layers.asFlattenedCanvas(
          this.context.sketchPane.width,
          this.context.sketchPane.height,
          this.context.visibleLayersIndices
        )
      )
    )
    this.flattenedLayerSprite.addChild(maskSprite)
    this.flattenedLayerSprite.mask = maskSprite

    this.layer.sprite.addChild(this.flattenedLayerSprite)

    // draw the cut sprite
    this.layer.sprite.addChild(this.cutSprite)

    // draw the outline
    this.layer.sprite.addChild(this.outlineSprite)

    // positioning
    this.draw()
    
    this.context.sketchPaneDOMElement.addEventListener('pointerdown', this._onPointerDown)
    document.addEventListener('pointermove', this._onPointerMove)
    document.addEventListener('pointerup', this._onPointerUp)
    window.addEventListener('keydown', this._onKeyDown)
  }

  shutdown () {
    if (!this.state.done) {
      this.cleanup()
      this.state.done = true
    }

    this.context.sketchPaneDOMElement.removeEventListener('pointerdown', this._onPointerDown)
    document.removeEventListener('pointermove', this._onPointerMove)
    document.removeEventListener('pointerup', this._onPointerUp)
    window.removeEventListener('keydown', this._onKeyDown)
  }

  _onPointerDown (event) {
    let point = this.context.sketchPane.localizePoint(event)
    this.state = {
      down: true,
      spriteOrigin: { x: this.cutSprite.x, y: this.cutSprite.y },
      origin: { x: point.x, y: point.y },
      position: { x: point.x, y: point.y }
    }
  }

  _onPointerMove (event) {
    if (this.state.down) {
      this.state.position = this.context.sketchPane.localizePoint(event)
      this.context.sketchPane.selectedArea.target.x = this.state.spriteOrigin.x + (this.state.position.x - this.state.origin.x)
      this.context.sketchPane.selectedArea.target.y = this.state.spriteOrigin.y + (this.state.position.y - this.state.origin.y)
      this.draw()
    }
  }

  _onPointerUp (event) {
    this.state.down = false
  }

  _onKeyDown (event) {
    if (this.context.isCommandPressed('drawing:marquee:cancel')) {
      this.cancel()
    }
    if (this.context.isCommandPressed('drawing:marquee:commit')) {
      this.commit()
    }
  }

  cleanup () {
    this.layer.sprite.removeChild(this.bgGraphics)
    this.layer.sprite.removeChild(this.flattenedLayerSprite)
    this.layer.sprite.removeChild(this.outlineSprite)
    this.layer.sprite.removeChild(this.cutSprite)
    this.layer.clear()

    this.context.marqueePath = null
  }

  complete () {
    this.cleanup()

    this.context.store.dispatch({
      type: 'TOOLBAR_MODE_STATUS_SET', payload: 'idle', meta: { scope: 'local' }
    })
    this.context.store.dispatch({
      type: 'TOOLBAR_MODE_SET', payload: 'marqueeOperation', meta: { scope: 'local' }
    })
  }

  cancel () {
    this.state.done = true
    this.complete()
  }

  commit () {
    this.context.emit('addToUndoStack', this.context.visibleLayersIndices)

    this.state.done = true
    // cut + paste each layer
    let inverseMask = this.context.sketchPane.selectedArea.asMaskSprite(true)
    for (let i of this.context.visibleLayersIndices) {
      // TODO this results in two rewrites, can it be simplified?

      let layer = this.context.sketchPane.layers[i]

      let layerCutSprite = this.context.sketchPane.selectedArea.asSprite([i])
      layerCutSprite.x = this.context.sketchPane.selectedArea.target.x
      layerCutSprite.y = this.context.sketchPane.selectedArea.target.y

      // cut & rewrite
      layer.applyMask(inverseMask)

      // paste & rewrite
      layer.sprite.addChild(layerCutSprite)
      layer.rewrite()
      layer.sprite.removeChild(layerCutSprite)
    }

    this.context.emit('markDirty', this.context.visibleLayersIndices)

    this.complete()
  }

  draw () {
    this.outlineSprite.x = this.context.sketchPane.selectedArea.target.x
    this.outlineSprite.y = this.context.sketchPane.selectedArea.target.y

    this.cutSprite.x = this.context.sketchPane.selectedArea.target.x
    this.cutSprite.y = this.context.sketchPane.selectedArea.target.y
  }
}

module.exports = MarqueeOperationStrategy
