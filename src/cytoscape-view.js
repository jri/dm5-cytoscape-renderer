import cytoscape from 'cytoscape'
import coseBilkent from 'cytoscape-cose-bilkent'
import cxtmenu from 'cytoscape-cxtmenu'
import fa from 'font-awesome/fonts/fontawesome-webfont.svg'
import DragState from './drag-state'
import dm5 from 'dm5'

// get style from CSS variables
const style = window.getComputedStyle(document.body)
const FONT_FAMILY          = style.getPropertyValue('--main-font-family')
const MAIN_FONT_SIZE       = style.getPropertyValue('--main-font-size')
const LABEL_FONT_SIZE      = style.getPropertyValue('--label-font-size')
const ICON_COLOR           = style.getPropertyValue('--color-topic-icon')
const HOVER_BORDER_COLOR   = style.getPropertyValue('--color-topic-hover')
const HIGHLIGHT_COLOR      = style.getPropertyValue('--highlight-color')
const BACKGROUND_COLOR     = style.getPropertyValue('--background-color')
const BORDER_COLOR_LIGHTER = style.getPropertyValue('--border-color-lighter')

var faFont      // Font Awesome SVG <font> element

const svgReady = dm5.restClient.getXML(fa).then(svg => {
  // console.log('### SVG ready!')
  faFont = svg.querySelector('font')
})

// register extensions
cytoscape.use(coseBilkent)
cytoscape.use(cxtmenu)

export default class CytoscapeView {

  constructor (renderer, parent, container, box, contextCommands, dispatch) {
    this.renderer = renderer,
    this.parent = parent,
    this.cy = this.instantiateCy(container)
    this.box = box              // the measurement box
    this.contextMenus(contextCommands)
    this.dispatch = dispatch
    this.svgReady = svgReady    // a promise resolved once the FontAwesome SVG is loaded
    // Note: by using arrow functions in a select handler 'this' refers to this CytoscapeView instance (instead of the
    // clicked Cytoscape element). In standard ES6 class methods can't be defined in arrow notation. This would require
    // the stage-2 "class properties" feature. For some reason the Babel "transform-class-properties" plugin does not
    // work when the application is build by Jenkins CI.
    // The solution is to define the select handlers in the constructor.
    this.onSelectNode   = this.nodeHandler('select')
    this.onSelectEdge   = this.edgeHandler('select')
    this.onUnselectNode = this.nodeHandler('unselect')
    this.onUnselectEdge = this.edgeHandler('unselect')
    this.eventHandlers()
  }

  nodeHandler (suffix) {
    // Note: a node might be an "auxiliary" node, that is a node that represents an edge.
    // In this case the original edge ID is contained in the node's "assocId" data.
    return e => {
      const _assocId = assocId(e.target)
      if (_assocId) {
        this.parent.$emit('assoc-' + suffix, _assocId)
      } else {
        this.parent.$emit('topic-' + suffix, id(e.target))
      }
    }
  }

  edgeHandler (suffix) {
    return e => {
      this.parent.$emit('assoc-' + suffix, id(e.target))
    }
  }

  // Cytoscape Instantiation

  instantiateCy (container) {
    return cytoscape({
      container,
      style: [
        {
          selector: 'node',
          style: {
            'shape': 'rectangle',
            'background-image': ele => this.renderNode(ele).url,
            'background-opacity': 0,
            'width':  ele => this.renderNode(ele).width,
            'height': ele => this.renderNode(ele).height,
            'border-width': 1,
            'border-color': BORDER_COLOR_LIGHTER,
            'border-opacity': 1
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 3,
            'line-color': 'rgb(178, 178, 178)',
            'curve-style': 'bezier',
            'label': 'data(label)',
            'font-family': FONT_FAMILY,
            'font-size': LABEL_FONT_SIZE,
            'text-margin-y': '-10',
            'text-rotation': 'autorotate'
          }
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 2,
            'border-color': HIGHLIGHT_COLOR
          }
        },
        {
          selector: 'edge:selected',
          style: {
            'width': 6
          }
        },
        {
          selector: 'node.expanded',
          style: {
            'border-opacity': 0
          }
        },
        {
          selector: 'node.hover',
          style: {
            'border-width': 3,
            'border-color': HOVER_BORDER_COLOR,
            'border-opacity': 1
          }
        }
      ],
      layout: {
        name: 'preset'
      },
      wheelSensitivity: 0.2
    })
  }

  // ### TODO: copy in topic-model.js
  cyElement (id) {
    return this.cy.getElementById(id.toString())
  }

  // Node Rendering

  // TODO: memoization
  renderNode (ele) {
    const label = ele.data('label')
    const iconPath = this.faGlyphPath(ele.data('icon'))
    const size = this.measureText(label)
    const width = size.width + 32
    const height = size.height + 8
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <rect x="0" y="0" width="${width}" height="${height}" fill="${BACKGROUND_COLOR}"></rect>
        <text x="26" y="${height - 7}" font-family="${FONT_FAMILY}" font-size="${MAIN_FONT_SIZE}">${label}</text>
        <path d="${iconPath}" fill="${ICON_COLOR}" transform="scale(0.009 -0.009) translate(600 -2000)"></path>
      </svg>`
    return {
      url: 'data:image/svg+xml,' + encodeURIComponent(svg),
      width, height
    }
  }

  faGlyphPath (unicode) {
    try {
      return faFont.querySelector(`glyph[unicode="${unicode}"]`).getAttribute('d')
    } catch (e) {
      throw Error(`Font Awesome glyph "${unicode}" not available (${e})`)
    }
  }

  measureText (text) {
    this.box.textContent = text
    return {
      width: this.box.clientWidth,
      height: this.box.clientHeight
    }
  }

  // Context Menus

  contextMenus (contextCommands) {
    // Note: a node might be an "auxiliary" node, that is a node that represents an edge.
    // In this case the original edge ID is contained in the node's "assocId" data.
    this.cy.cxtmenu({
      selector: 'node',
      commands: ele => assocId(ele) ? assocCommands(assocId) : topicCommands(),
      atMouse: true
    })
    this.cy.cxtmenu({
      selector: 'edge',
      commands: ele => assocCommands(id)
    })

    const topicCommands = () => contextCommands.topic.map(cmd => ({
      content: cmd.label,
      select: this.topicHandler(cmd)
    }))

    const assocCommands = idMapper => contextCommands.assoc.map(cmd => ({
      content: cmd.label,
      select: this.assocHandler(cmd, idMapper)
    }))
  }

  topicHandler (cmd) {
    return ele => {
      const topicId = id(ele)
      this.invokeTopicSelection(topicId, cmd.handler, topicId, id => id)
    }
  }

  assocHandler (cmd, idMapper) {
    return ele => {
      const assocId = idMapper(ele)
      this.invokeAssocSelection(assocId, cmd.handler, assocId, id => id)
    }
  }

  // Event Handling

  onSelectHandlers () {
    this.cy
      .on('select', 'node', this.onSelectNode)
      .on('select', 'edge', this.onSelectEdge)
  }

  offSelectHandlers () {
    this.cy
      .off('select', 'node', this.onSelectNode)
      .off('select', 'edge', this.onSelectEdge)
  }

  onUnselectHandlers () {
    this.cy
      .on('unselect', 'node', this.onUnselectNode)
      .on('unselect', 'edge', this.onUnselectEdge)
  }

  offUnselectHandlers () {
    this.cy
      .off('unselect', 'node', this.onUnselectNode)
      .off('unselect', 'edge', this.onUnselectEdge)
  }

  /**
   * Registers Cytoscape event handlers.
   */
  eventHandlers () {
    this.onSelectHandlers()
    this.onUnselectHandlers()
    this.cy.on('tap', 'node', e => {
      const clicks = e.originalEvent.detail
      // console.log('tap node', id(e.target), e.originalEvent, clicks)
      if (clicks === 2) {
        this.parent.$emit('topic-double-click', e.target.data('viewTopic'))
      }
    }).on('cxttap', e => {
      if (e.target === this.cy) {
        this.parent.$emit('topicmap-contextmenu', {
          model:  e.position,
          render: e.renderedPosition
        })
      }
    }).on('tapstart', 'node', e => {
      const dragState = new DragState(e.target)
      const handler = this.dragHandler(dragState)
      this.cy.on('tapdrag', handler)
      this.cy.one('tapend', e => {
        this.cy.off('tapdrag', handler)
        if (dragState.hoverNode) {
          dragState.unhover()
          dragState.resetPosition()
          this.parent.$emit('topic-drop-on-topic', {
            // topic 1 dropped onto topic 2
            topicId1: id(dragState.node),
            topicId2: id(dragState.hoverNode)
          })
        } else if (dragState.drag) {
          this.topicDrag(dragState.node)
        }
      })
    }).on('zoom', () => {
      this.renderer.zoom = this.cy.zoom()
    })
  }

  dragHandler (dragState) {
    return e => {
      var _node = this.nodeAt(e.position, dragState.node)
      if (_node) {
        if (_node !== dragState.hoverNode) {
          dragState.hoverNode && dragState.unhover()
          dragState.hoverNode = _node
          dragState.hover()
        }
      } else {
        if (dragState.hoverNode) {
          dragState.unhover()
          dragState.hoverNode = undefined
        }
      }
      dragState.drag = true
    }
  }

  nodeAt (pos, excludeNode) {
    var foundNode
    this.cy.nodes().forEach(node => {
      if (node !== excludeNode && this.isInside(pos, node)) {
        foundNode = node
        return false    // abort iteration
      }
    })
    return foundNode
  }

  isInside (pos, node) {
    var x = pos.x
    var y = pos.y
    var box = node.boundingBox()
    return x > box.x1 && x < box.x2 && y > box.y1 && y < box.y2
  }

  topicDrag (node) {
    if (!assocId(node)) {   // aux nodes don't emit topic-drag events
      this.invokeTopicSelection(id(node), this.emitTopicDrag, node, id => this.cyElement(id))
    }
    this.dispatch('_playFisheyeAnimation')    // TODO: play only if details are visible
  }

  emitTopicDrag (node) {
    this.parent.$emit('topic-drag', {
      id: id(node),
      pos: node.position()
    })
  }

  // View Synchronization

  select (ele) {
    this.offSelectHandlers()
    ele.select()
    this.onSelectHandlers()
    return ele
  }

  unselect (ele) {
    this.offUnselectHandlers()
    ele.unselect()
    this.onUnselectHandlers()
    return ele
  }

  // Helper

  invokeTopicSelection (topicId, handler, singleArg, multiFn) {
    this._invokeSelection(this.parent.selection.topicIds, topicId, handler, singleArg, multiFn)
  }

  invokeAssocSelection (assocId, handler, singleArg, multiFn) {
    this._invokeSelection(this.parent.selection.assocIds, assocId, handler, singleArg, multiFn)
  }

  _invokeSelection (selIds, clickedId, handler, singleArg, multiFn) {
    if (selIds.includes(clickedId)) {
      console.log('invoke selection', selIds)
      // Note: the handler might manipulate the selection (e.g. a hide/delete operation),
      // so we clone it before iterating over it
      dm5.utils.clone(selIds).forEach(id => handler.call(this, multiFn(id)))
    } else {
      console.log('invoke clicked', clickedId)
      handler.call(this, singleArg)
    }
  }
}

// copy in dm5-detail-layer.vue
function id (ele) {
  // Note: cytoscape element IDs are strings
  return Number(ele.id())
}

// ID mapper for aux nodes
function assocId (ele) {
  return ele.data('assocId')
}
