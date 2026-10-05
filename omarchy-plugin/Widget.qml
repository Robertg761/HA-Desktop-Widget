import QtQuick
import QtQuick.Controls as Controls
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Clip.js" as Clip
import "Countdown.js" as Countdown

// Home Assistant in the Omarchy bar. HA Desktop Widget publishes its connection state and its
// Quick Access tiles to $XDG_RUNTIME_DIR/ha-desktop-widget/omarchy-bar.json; this widget draws
// those tiles and sends clicks back to the widget, so no Home Assistant credentials ever reach
// the shell. A click on a tile does what clicking that tile in the widget does; holding it opens
// its controls (brightness, speed, position, temperature, volume) right here in the panel.
//
// Requests go to the running widget over its socket, $XDG_RUNTIME_DIR/ha-desktop-widget/
// omarchy-bar.sock. When the widget is not running, the widget's command line starts it.
//
// Settings, inline on this widget's entry in ~/.config/omarchy/shell.json:
//   "entities":    entity ids shown in the panel (default: every Quick Access tile)
//   "barEntities": up to four entity ids whose values are shown in the bar itself
//   "command":     the widget's command when it is not running (default: the command the
//                  widget last saved, then ha-desktop-widget)
Panel {
  id: root
  moduleName: "com.github.robertg761.hadesktopwidget"
  ipcTarget: "com.github.robertg761.hadesktopwidget"
  manageIpc: false

  readonly property string runtimeDir: Quickshell.env("XDG_RUNTIME_DIR") || ""
  readonly property string statusPath: runtimeDir ? runtimeDir + "/ha-desktop-widget/omarchy-bar.json" : ""
  readonly property string socketPath: runtimeDir ? runtimeDir + "/ha-desktop-widget/omarchy-bar.sock" : ""
  // Written by the widget on start and kept after it quits, so the bar can start it again even
  // when it is an AppImage with no ha-desktop-widget command on PATH.
  readonly property string launchPath: {
    var stateHome = Quickshell.env("XDG_STATE_HOME") || (Quickshell.env("HOME") + "/.local/state")
    return stateHome + "/ha-desktop-widget/omarchy-bar-launch.json"
  }
  // The widget rewrites the file every minute and deletes it when it quits, so one older than a beat
  // and a half belongs to a widget that crashed or was killed.
  readonly property int staleAfterMs: 90000
  // A file stamped further ahead than this was written before the clock was set back.
  readonly property int clockSlackMs: 5000
  // A widget whose socket dropped and which has not written since this long ago is gone, whatever
  // the age of its last write says.
  readonly property int socketLostGraceMs: 6000

  property var status: null
  // The time of the last write, kept apart from the tiles: it changes every minute even when nothing
  // else does, and the tiles are only rebuilt when something they show has.
  property double statusUpdatedAt: 0
  property string statusSignature: ""
  property double socketLostAt: 0
  property bool socketWasConnected: false
  property var savedLaunch: null
  property double now: Date.now()

  readonly property double statusAge: now - statusUpdatedAt
  readonly property bool socketAbandoned: socketLostAt > 0
    && statusUpdatedAt <= socketLostAt
    && now - socketLostAt > socketLostGraceMs
  readonly property bool running: status !== null
    && statusAge > -clockSlackMs
    && statusAge < staleAfterMs
    && !socketAbandoned
  readonly property bool connected: running && status.connection === "connected"
  readonly property var panelTiles: running && Array.isArray(status.panel) ? status.panel : []
  readonly property var barTiles: running && Array.isArray(status.bar) ? status.bar : []
  readonly property var lineIcons: running && status.icons ? status.icons : ({})
  // How many tiles the widget left out of the panel to keep the status small.
  readonly property int omitted: running && typeof status.omitted === "number" ? status.omitted : 0
  readonly property var barValues: barTiles
    .map(function(tile) { return Countdown.value(tile, root.now) })
    .filter(function(value) { return value !== "" })
  // The bar slot is as wide as its text, so each value is cut to a short stretch and the whole
  // readout to a few dozen characters (a media title can run to 96); the tooltip has them in
  // full. A vertical bar has a slot one glyph wide, so it shows only the glyph.
  readonly property bool verticalBar: bar ? bar.vertical === true : false
  readonly property int barValueChars: 16
  readonly property int barTextChars: 48
  readonly property string barText: verticalBar ? "" : clipText(
    barValues.map(function(value) { return clipText(value, barValueChars) }).join("  "),
    barTextChars
  )
  readonly property bool hasVisibleCountdown: running && (
    barTiles.some(function(tile) { return Countdown.isRunning(tile, root.now) })
    || (opened && panelTiles.some(function(tile) { return Countdown.isRunning(tile, root.now) }))
  )

  // The panel's tiles grouped under the widget's Quick Access pages. A page name of "" draws
  // no heading; files from widget versions without sections read as one untitled page.
  readonly property var sections: {
    var byId = ({})
    panelTiles.forEach(function(tile) { byId[tile.id] = tile })
    var raw = running && Array.isArray(status.sections) && status.sections.length > 0
      ? status.sections
      : [{ name: "", ids: panelTiles.map(function(tile) { return tile.id }) }]
    var offset = 0
    var result = []
    raw.forEach(function(section) {
      var tiles = (Array.isArray(section.ids) ? section.ids : [])
        .map(function(id) { return byId[id] })
        .filter(function(tile) { return tile !== undefined })
      if (tiles.length === 0) return
      result.push({ name: String(section.name || ""), tiles: tiles, offset: offset })
      offset += tiles.length
    })
    return result
  }
  readonly property var flatTiles: {
    var list = []
    sections.forEach(function(section) { list = list.concat(section.tiles) })
    return list
  }

  // The tile whose controls are open in the panel, kept current as its state changes.
  property string controlsId: ""
  readonly property var controlsTile: {
    if (controlsId === "") return null
    for (var i = 0; i < flatTiles.length; i++) {
      if (flatTiles[i].id === controlsId) return flatTiles[i]
    }
    return null
  }
  readonly property var controlState: controlsTile && controlsTile.controlState ? controlsTile.controlState : null
  readonly property bool showingControls: controlsTile !== null && controlState !== null

  readonly property color foreground: bar ? bar.foreground : Color.popups.text
  // The tone of secondary lines (status text, counts, "Unavailable"): the foreground blended toward
  // the panel, and no further than still reads at 4.5:1 there. Qt.darker made a light theme's dim
  // text darker than its primary text, and left several dark themes under 4.5:1 at 10 px.
  readonly property color dimColor: quietTone(foreground, Color.popups.background)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property int columns: Math.max(1, Math.min(4, flatTiles.length))
  readonly property real tileGap: Style.space(8)

  function colorChannel(value) {
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  }

  function luminance(c) {
    return 0.2126 * colorChannel(c.r) + 0.7152 * colorChannel(c.g) + 0.0722 * colorChannel(c.b)
  }

  function contrastRatio(a, b) {
    var x = luminance(a)
    var y = luminance(b)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }

  // A tone between background and foreground, starting at 70% of the way to the foreground and going
  // on only until it reads. A foreground that does not reach 4.5:1 itself is returned as it is.
  function quietTone(fg, bg) {
    var tone = fg
    for (var share = 0.7; share <= 1.0001; share += 0.05) {
      var amount = Math.min(1, share)
      tone = Qt.rgba(bg.r + (fg.r - bg.r) * amount,
                     bg.g + (fg.g - bg.g) * amount,
                     bg.b + (fg.b - bg.b) * amount, 1)
      if (contrastRatio(tone, bg) >= 4.5) break
    }
    return tone
  }

  // Keyboard cursor, shared with mouse hover so only one tile is ever highlighted.
  property bool cursorActive: false
  property int cursorIndex: 0

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  // Cut to `limit` characters as a reader counts them (grapheme clusters, see Clip.js), so an emoji
  // or a letter with its accents is never split at the cut.
  function clipText(text, limit) {
    return Clip.clip(text, limit)
  }

  // The panel's words come from the widget, in the language it is showing (status.strings). This is
  // the English they fall back to when the widget is older than the string, or is not running.
  function word(id, english) {
    var strings = status ? status.strings : null
    return strings && typeof strings[id] === "string" && strings[id] !== "" ? strings[id] : english
  }

  function statusLine() {
    if (!running) return word("notRunning", "HA Desktop Widget is not running")
    if (status.issue === "keyring") return word("keyringLocked", "Keyring locked. Unlock it, then restart the widget.")
    if (status.connection === "connected") return word("connected", "Connected")
    if (status.connection === "auth-failed") return word("signInNeeded", "Sign-in needed. Open the widget to reconnect.")
    if (status.connection === "connecting") return word("connecting", "Connecting...")
    return word("disconnected", "Disconnected. Retrying automatically.")
  }

  // Runs the widget's own command line. A running widget receives it through its
  // single-instance handler; otherwise the command starts the widget.
  // A running widget is reached through its own command. Otherwise an explicit "command"
  // setting wins over the remembered one, so a wrapper or replacement can be configured.
  function launch(extraArgs) {
    var configured = String(setting("command", "")).trim()
    var argv = running && Array.isArray(status.launch) && status.launch.length > 0
      ? status.launch.slice()
      : configured !== ""
        ? [configured]
        : Array.isArray(savedLaunch) && savedLaunch.length > 0
          ? savedLaunch.slice()
          : ["ha-desktop-widget"]
    Quickshell.execDetached(argv.concat(extraArgs))
  }

  // One request to the running widget over its socket. Returns false when the socket is not
  // connected, so the caller can fall back to the command line.
  function sendRequest(request) {
    if (!commandSocket || !commandSocket.connected) return false
    commandSocket.write(JSON.stringify(request) + "\n")
    commandSocket.flush()
    return true
  }

  // A fresh socket for each attempt: the widget's socket goes away whenever it restarts, and a
  // socket whose connection failed does not try again by itself.
  property var commandSocket: null
  readonly property bool socketConnected: commandSocket !== null && commandSocket.connected

  function ensureSocket() {
    if (socketConnected) return
    if (commandSocket) commandSocket.destroy()
    commandSocket = running && socketPath !== "" ? socketComponent.createObject(root) : null
  }

  onRunningChanged: ensureSocket()

  // A socket that was connected and then dropped: the widget restarted, or it died. A restart
  // writes its status again at once; a crash does not, and the file would keep saying "connected"
  // for as long as it takes to go stale.
  onSocketConnectedChanged: {
    if (socketConnected) {
      socketWasConnected = true
      socketLostAt = 0
    } else if (socketWasConnected) {
      socketWasConnected = false
      socketLostAt = Date.now()
      lostTimer.restart()
    }
  }

  function applySavedLaunch(text) {
    try {
      var parsed = JSON.parse(text)
      root.savedLaunch = parsed && parsed.version === 1 && Array.isArray(parsed.launch)
        ? parsed.launch
        : null
    } catch (error) {
      root.savedLaunch = null
    }
  }

  function toggleWidget() {
    root.close()
    launch(["--toggle"])
  }

  // What a click on the tile does in the widget: toggle it, run it, or open its dialog there.
  function canActivate(tile) {
    return connected && tile && tile.action !== undefined && tile.action !== "none"
  }

  function canAdjust(tile) {
    return connected && tile && tile.controls === true
  }

  function activateTile(tile) {
    if (!canActivate(tile)) return
    // A dialog opens in the widget, which comes forward; the panel would sit in front of it.
    if (tile.action === "dialog") root.close()
    if (!sendRequest({ id: tile.id, kind: "primary" })) launch(["--entity-action=" + tile.id])
  }

  // Holding a tile, its adjust button, or a right-click: its controls, here in the panel. Tiles
  // whose controls the panel cannot draw open the widget's controls dialog instead.
  function adjustTile(tile) {
    if (!canAdjust(tile)) return
    if (tile.controlState) {
      controlsId = tile.id
      return
    }
    openInWidget(tile)
  }

  function openInWidget(tile) {
    if (!canAdjust(tile)) return
    root.close()
    if (!sendRequest({ id: tile.id, kind: "controls" })) launch(["--entity-controls=" + tile.id])
  }

  function closeControls() {
    controlsId = ""
  }

  // A change made in the controls popup. Only through the socket: starting a second copy of the
  // widget for every slider step would be far too slow.
  function setControl(command, value) {
    if (!controlsTile || !connected) return
    var request = { id: controlsTile.id, kind: "set", command: command }
    if (value !== undefined) request.value = value
    sendRequest(request)
  }

  // The tile drawn for each position in flatTiles, so the cursor can be brought into view.
  property var tileItems: ({})

  // Scroll the panel so an item (the highlighted tile, or the control the keyboard is on) is fully
  // inside it. With more tiles than fit, the cursor used to walk off the bottom, and Enter then
  // switched something the person could not see.
  function ensureVisible(item) {
    if (!item) return
    var top = item.mapToItem(flick.contentItem, 0, 0).y
    var margin = Style.space(6)
    var visibleTop = flick.contentY
    var visibleBottom = flick.contentY + flick.height
    if (top - margin < visibleTop) {
      flick.contentY = Math.max(0, top - margin)
    } else if (top + item.height + margin > visibleBottom) {
      flick.contentY = Math.max(0, Math.min(flick.contentHeight - flick.height, top + item.height + margin - flick.height))
    }
  }

  function ensureCursorVisible() {
    if (showingControls) return
    ensureVisible(tileItems[cursorIndex])
  }

  function moveCursor(dx, dy) {
    if (showingControls) {
      controlsView.move(dx, dy)
      return
    }
    var count = flatTiles.length
    if (count === 0) return
    if (!cursorActive) {
      cursorActive = true
      ensureCursorVisible()
      return
    }
    var next = cursorIndex + dx + dy * columns
    cursorIndex = Math.max(0, Math.min(count - 1, next))
    ensureCursorVisible()
  }

  // The highlighted tile's controls, from the keyboard: the same as press-and-hold, the Adjust
  // button or a right-click.
  function adjustCursorTile() {
    if (showingControls || !cursorActive) return
    var tile = flatTiles[cursorIndex]
    if (tile && canAdjust(tile)) adjustTile(tile)
  }

  // Icon SVGs from the widget draw with currentColor; paint them in the tile's colour.
  function lineIconSource(name, color) {
    var svg = lineIcons[name]
    if (!svg) return ""
    var hex = "#" + [color.r, color.g, color.b]
      .map(function(channel) { return ("0" + Math.round(channel * 255).toString(16)).slice(-2) })
      .join("")
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg.split("currentColor").join(hex))
  }

  function formatTemperature(value) {
    if (value === null || value === undefined) return "–"
    var rounded = Math.round(value * 10) / 10
    return (rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)) + "°"
  }

  function modeLabel(mode) {
    var labels = {
      heat_cool: word("modeHeatCool", "Heat/Cool"),
      fan_only: word("modeFan", "Fan"),
      dry: word("modeDry", "Dry"),
      off: word("off", "Off")
    }
    if (labels[mode]) return labels[mode]
    return mode.charAt(0).toUpperCase() + mode.slice(1).replace(/_/g, " ")
  }

  function clearStatus() {
    root.status = null
    root.statusSignature = ""
    root.statusUpdatedAt = 0
    root.now = Date.now()
  }

  function applyStatus(text) {
    var parsed = null
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      parsed = null
    }
    if (!parsed || parsed.version !== 1) {
      clearStatus()
      return
    }
    // Every write carries a new updatedAt, the heartbeat's included. Only a change to something the
    // panel shows replaces the status, so a quiet minute does not rebuild every tile.
    var updatedAt = typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0
    parsed.updatedAt = 0
    var signature = JSON.stringify(parsed)
    root.statusUpdatedAt = updatedAt
    if (signature !== root.statusSignature) {
      root.statusSignature = signature
      root.status = parsed
    }
    root.now = Date.now()
    if (root.cursorIndex >= root.flatTiles.length) root.cursorIndex = Math.max(0, root.flatTiles.length - 1)
  }

  // The tiles exist only while the panel is open, and for its fade-out. Dozens of items with a mouse
  // area and an image each are a lot for the shell to keep alive for a panel that is closed most of
  // the day, and they were rebuilt on every status write.
  property bool tilesLive: false

  Timer {
    id: tilesLiveTimer
    interval: 400
    onTriggered: root.tilesLive = false
  }

  onOpenedChanged: {
    if (!opened) {
      tilesLiveTimer.restart()
      return
    }
    tilesLiveTimer.stop()
    tilesLive = true
    cursorActive = false
    cursorIndex = 0
    controlsId = ""
    now = Date.now()
  }

  FileView {
    id: statusFile
    path: root.statusPath
    watchChanges: true
    // Absent whenever the widget is not running.
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.applyStatus(text())
    onLoadFailed: root.clearStatus()
  }

  FileView {
    id: launchFile
    path: root.launchPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.applySavedLaunch(text())
    onLoadFailed: root.savedLaunch = null
  }

  Component {
    id: socketComponent
    Socket {
      path: root.socketPath
      connected: true
    }
  }

  // Connect to a running widget, and again after it restarts.
  Timer {
    interval: 2000
    repeat: true
    running: root.running && !root.socketConnected
    triggeredOnStart: true
    onTriggered: root.ensureSocket()
  }

  // Looks again once the grace for a dropped socket has passed.
  Timer {
    id: lostTimer
    interval: root.socketLostGraceMs + 200
    onTriggered: root.now = Date.now()
  }

  // Catches a widget that starts after the shell, and ages out one that stopped.
  Timer {
    interval: 5000
    running: root.statusPath !== ""
    repeat: true
    onTriggered: {
      root.now = Date.now()
      if (!root.running) statusFile.reload()
    }
  }

  // Only visible, running timers need second-by-second updates. The widget can stay hidden.
  Timer {
    interval: 1000
    running: root.hasVisibleCountdown
    repeat: true
    onTriggered: root.now = Date.now()
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.barText !== "" ? "󰟐  " + root.barText : "󰟐"
    dimmed: !root.connected
    tooltipText: root.running
      ? "Home Assistant: " + root.statusLine() + (root.barValues.length > 0 ? "\n" + root.barValues.join("  ") : "")
      : root.statusLine()
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.RightButton || buttonCode === Qt.MiddleButton) root.toggleWidget()
      else if (!root.running || root.flatTiles.length === 0) root.toggleWidget()
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(480))
    contentHeight: panel.fittedContentHeight(content.implicitHeight, Style.space(640))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: {
        if (root.showingControls) root.closeControls()
        else root.close()
      }
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onMoveRequested: function(dx, dy) { root.moveCursor(dx, dy) }
      onActivateRequested: {
        if (root.showingControls) controlsView.activate()
        else if (root.cursorActive) root.activateTile(root.flatTiles[root.cursorIndex])
      }

      // A on a tile opens its controls, which the arrows then adjust. Connected, rather than bound
      // with onTextKey on the catcher, so that a shell whose catcher has no textKey signal loses
      // this one shortcut instead of failing to load the whole panel.
      Connections {
        target: keyCatcher
        ignoreUnknownSignals: true
        function onTextKey(text) {
          if (text === "a" || text === "A") root.adjustCursorTile()
        }
      }

      Flickable {
        id: flick
        anchors.fill: parent
        contentHeight: content.implicitHeight
        interactive: contentHeight > height
        clip: true

        // With more tiles than fit, the ones below the fold gave no sign they were there. A thin bar
        // that stays while there is more to scroll to, in the panel's own text colour.
        Controls.ScrollBar.vertical: Controls.ScrollBar {
          policy: flick.contentHeight > flick.height ? Controls.ScrollBar.AlwaysOn : Controls.ScrollBar.AlwaysOff
          contentItem: Rectangle {
            implicitWidth: Style.space(3)
            radius: width / 2
            color: Util.alpha(root.foreground, 0.4)
          }
        }

        // The control the keyboard is on in a tile's controls. It lives in the scrolled content,
        // so it moves with what it outlines.
        Rectangle {
          parent: flick.contentItem
          z: 100
          visible: controlsView.visible && controlsView.ringRect.width > 0
          // Inside the control's own bounds: one that spans the panel would lose its sides to the clip.
          x: controlsView.ringRect.x
          y: controlsView.ringRect.y
          width: controlsView.ringRect.width
          height: controlsView.ringRect.height
          radius: Style.cornerRadius
          color: "transparent"
          border.width: 2
          border.color: Color.accent
        }

        Column {
          id: content
          width: flick.width
          spacing: Style.space(10)

          Item {
            visible: !root.showingControls
            width: parent.width
            height: visible ? Math.max(heading.implicitHeight, openButton.implicitHeight) : 0

            Column {
              id: heading
              anchors.left: parent.left
              anchors.right: openButton.left
              anchors.rightMargin: Style.space(8)
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(2)

              PlainText {
                width: parent.width
                text: "Home Assistant"
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
                font.bold: true
                elide: Text.ElideRight
              }

              PlainText {
                width: parent.width
                text: root.statusLine()
                color: root.connected || (root.running && root.status.connection === "connecting")
                  ? root.dimColor : Color.urgent
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                wrapMode: Text.WordWrap
              }
            }

            PanelActionButton {
              id: openButton
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              iconText: "󰏌"
              tooltipText: root.running ? root.word("openWidget", "Open HA Desktop Widget") : root.word("startWidget", "Start HA Desktop Widget")
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: root.toggleWidget()
            }
          }

          PlainText {
            visible: !root.showingControls && root.running && root.flatTiles.length === 0
            width: parent.width
            text: root.word("emptyState", "Add entities to Quick Access in the widget to see them here.")
            color: root.dimColor
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          // The repeaters count sections and tiles rather than being handed them, so a status that
          // changes one tile's reading updates that tile in place. Handed the arrays, they threw
          // every tile away and built it again, which cancelled a press-and-hold in progress.
          Repeater {
            model: root.tilesLive && !root.showingControls ? root.sections.length : 0

            delegate: Column {
              id: sectionColumn
              required property int index
              readonly property var section: root.sections[index] || ({ name: "", tiles: [], offset: 0 })
              width: content.width
              spacing: Style.space(6)

              PanelSectionHeader {
                visible: sectionColumn.section.name !== ""
                text: sectionColumn.section.name
                foreground: root.foreground
                fontFamily: root.fontFamily
              }

              Grid {
                id: grid
                columns: root.columns
                spacing: root.tileGap
                readonly property real tileWidth:
                  (sectionColumn.width - (root.columns - 1) * root.tileGap) / root.columns

                Repeater {
                  model: sectionColumn.section.tiles.length

                  delegate: HaTile {
                    required property int index
                    tile: sectionColumn.section.tiles[index] || ({})
                    flatIndex: sectionColumn.section.offset + index
                    width: grid.tileWidth
                  }
                }
              }
            }
          }

          PlainText {
            visible: !root.showingControls && root.running && root.omitted > 0
            width: parent.width
            text: root.omitted === 1
              ? root.word("omittedOne", "1 more tile is not shown here. Open the widget to see it.")
              : root.word("omittedMany", "{{count}} more tiles are not shown here. Open the widget to see them.").replace("{{count}}", root.omitted)
            color: root.dimColor
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          ControlsView {
            id: controlsView
            visible: root.showingControls
            width: parent.width
            ringHost: flick.contentItem
          }
        }
      }
    }
  }

  // Every Text here shows something Home Assistant or the person who named an entity supplied: a tile
  // name, a reading, a calendar event's title, a track. The default format promotes anything that
  // looks like markup to rich text, which drops the markup's own characters ("Humidity <b>zone</b>
  // <Main>" lost its <Main>) and fetches a picture from any <img src="http://...">, even while the
  // panel is closed. Plain text shows exactly what was sent.
  component PlainText: Text {
    textFormat: Text.PlainText
  }

  // A tile's icon: the widget's own line icon, or an MDI or emoji glyph.
  component TileIcon: Item {
    id: iconRoot
    property var icon: null
    property color color: root.foreground
    property real iconOpacity: 1

    Image {
      anchors.fill: parent
      visible: iconRoot.icon !== null && iconRoot.icon.kind === "line"
      source: visible ? root.lineIconSource(iconRoot.icon.name, iconRoot.color) : ""
      sourceSize.width: Math.round(width * 2)
      sourceSize.height: Math.round(height * 2)
      fillMode: Image.PreserveAspectFit
      opacity: iconRoot.iconOpacity
    }

    PlainText {
      anchors.centerIn: parent
      visible: iconRoot.icon !== null && iconRoot.icon.kind === "glyph"
      text: visible ? iconRoot.icon.glyph : ""
      color: iconRoot.color
      opacity: iconRoot.iconOpacity
      font.family: root.fontFamily
      font.pixelSize: Math.round(iconRoot.height * 0.9)
    }
  }

  // One Quick Access tile, drawn like the widget's: icon, name, status line; accent-tinted while
  // on, dimmed while unavailable, with the adjust button on tiles that have controls.
  component HaTile: BorderSurface {
    id: tileRoot
    property var tile: ({})
    property int flatIndex: 0
    property bool held: false
    readonly property bool hasCursor: root.cursorActive && root.cursorIndex === flatIndex
    readonly property bool active: tile.active === true
    readonly property bool available: tile.available === true
    readonly property bool actionable: root.canActivate(tile)
    readonly property color iconColor: active ? Color.accent : root.foreground

    // The tile registers itself under its position, and moves when a page gains or loses a tile above it.
    property int registeredIndex: -1
    function register() {
      if (registeredIndex >= 0 && root.tileItems[registeredIndex] === tileRoot) delete root.tileItems[registeredIndex]
      registeredIndex = flatIndex
      root.tileItems[flatIndex] = tileRoot
    }
    Component.onCompleted: register()
    onFlatIndexChanged: if (registeredIndex >= 0) register()
    Component.onDestruction: {
      if (root.tileItems[registeredIndex] === tileRoot) delete root.tileItems[registeredIndex]
    }

    height: Style.space(92)
    radius: Style.cornerRadius
    color: active
      ? Util.alpha(Color.accent, hasCursor ? 0.24 : 0.16)
      : (!available
        ? "transparent"
        : (hasCursor ? Style.hoverFillFor(root.foreground, Color.accent) : Style.normalFillFor(root.foreground, Color.accent)))
    borderSpec: active
      ? Border.flat(Util.alpha(Color.accent, hasCursor ? 0.7 : 0.42), 1)
      : Border.controlSpec(hasCursor ? "hover-cursor" : "normal", root.foreground, Color.accent)
    scale: tileMouse.pressed && (actionable || root.canAdjust(tile)) ? 0.96 : 1

    Behavior on color { ColorAnimation { duration: 90 } }
    Behavior on scale { NumberAnimation { duration: 80 } }

    Column {
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.space(6)
      anchors.rightMargin: Style.space(6)
      spacing: Style.space(3)

      TileIcon {
        anchors.horizontalCenter: parent.horizontalCenter
        width: Style.space(22)
        height: Style.space(22)
        icon: tileRoot.tile.icon || null
        color: tileRoot.iconColor
        // An unavailable tile is dimmed by its name's tone and its icon, not by fading the whole
        // column, which put its text under 3:1 on most themes.
        iconOpacity: tileRoot.active ? 1 : (tileRoot.available ? 0.72 : 0.45)
      }

      PlainText {
        width: parent.width
        text: tileRoot.tile.name || tileRoot.tile.id || ""
        color: tileRoot.available ? root.foreground : root.dimColor
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        font.bold: true
        horizontalAlignment: Text.AlignHCenter
        wrapMode: Text.Wrap
        maximumLineCount: 2
        elide: Text.ElideRight
      }

      PlainText {
        width: parent.width
        visible: text !== ""
        text: Countdown.value(tileRoot.tile, root.now)
        color: tileRoot.active ? Qt.darker(root.foreground, 1.2) : root.dimColor
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        horizontalAlignment: Text.AlignHCenter
        elide: Text.ElideRight
      }
    }

    MouseArea {
      id: tileMouse
      anchors.fill: parent
      hoverEnabled: true
      acceptedButtons: Qt.LeftButton | Qt.RightButton
      // The same hold the widget's tiles use to open their controls.
      pressAndHoldInterval: 500
      cursorShape: tileRoot.actionable || root.canAdjust(tileRoot.tile) ? Qt.PointingHandCursor : Qt.ArrowCursor
      onContainsMouseChanged: {
        if (!containsMouse) return
        root.cursorIndex = tileRoot.flatIndex
        root.cursorActive = true
      }
      onPressed: tileRoot.held = false
      onPressAndHold: {
        if (!root.canAdjust(tileRoot.tile)) return
        tileRoot.held = true
        root.adjustTile(tileRoot.tile)
      }
      onClicked: function(mouse) {
        if (tileRoot.held) return
        if (mouse.button === Qt.RightButton) root.adjustTile(tileRoot.tile)
        else root.activateTile(tileRoot.tile)
      }
    }

    PanelActionButton {
      anchors.top: parent.top
      anchors.right: parent.right
      anchors.margins: Style.space(3)
      visible: root.canAdjust(tileRoot.tile)
      size: Style.space(20)
      fontSize: Style.font.bodySmall
      iconText: "󰘮"
      tooltipText: root.word("adjust", "Adjust")
      foreground: tileRoot.iconColor
      fontFamily: root.fontFamily
      onClicked: root.adjustTile(tileRoot.tile)
    }
  }

  // A labelled slider for the controls popup. It keeps showing the value you let go of until
  // Home Assistant reports the change, instead of snapping back for a moment.
  component ControlSlider: Column {
    id: sliderRoot
    property string label: ""
    property real value: 0
    property real minimum: 0
    property real maximum: 100
    property real step: 1
    property var format: function(v) { return Math.round(v) + "%" }
    property real heldValue: 0
    readonly property real shownValue: holdTimer.running ? heldValue : value
    // A stop for the keyboard in the controls view; Left and Right nudge it (see ControlsView.move).
    property bool keyStop: true
    readonly property bool isSlider: true
    signal valueSet(real value)

    function snap(v) {
      var snapped = Math.round((v - minimum) / step) * step + minimum
      return Math.max(minimum, Math.min(maximum, Math.round(snapped * 100) / 100))
    }

    function set(v) {
      heldValue = snap(v)
      holdTimer.restart()
      valueSet(heldValue)
    }

    // Keyboard left/right: one step of a tenth of the range, at least one slider step.
    function nudge(direction) {
      var amount = Math.max(step, Math.round((maximum - minimum) / 10 / step) * step)
      set(shownValue + direction * amount)
    }

    spacing: Style.space(4)

    Timer { id: holdTimer; interval: 2500 }

    Item {
      width: parent.width
      height: sliderLabel.implicitHeight

      PlainText {
        id: sliderLabel
        text: sliderRoot.label
        color: root.dimColor
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        font.bold: true
      }

      PlainText {
        anchors.right: parent.right
        text: sliderRoot.format(slider.dragging ? sliderRoot.snap(slider.liveValue) : sliderRoot.shownValue)
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }
    }

    Item {
      width: parent.width
      height: Style.space(24)

      PanelSlider {
        id: slider
        anchors.fill: parent
        bar: root.bar
        minimum: sliderRoot.minimum
        maximum: sliderRoot.maximum
        step: sliderRoot.step
        integer: sliderRoot.step >= 1
        value: sliderRoot.shownValue
        onMoved: function(v) { sliderRoot.set(v) }
        onReleased: function(v) { sliderRoot.set(v) }
      }
    }
  }

  // Buttons the keyboard can land on in the controls view (see ControlsView.move). Enter presses
  // the one it is on, through pressStop(), the same as a click.
  component KeyButton: Button {
    property bool keyStop: true
    function pressStop() { clicked() }
  }

  component KeyActionButton: PanelActionButton {
    property bool keyStop: true
    function pressStop() { clicked() }
  }

  // A row of equal-width buttons (presets, cover and media actions, climate modes).
  component ChoiceRow: Row {
    id: rowRoot
    property var choices: []
    property int columns: Math.max(1, choices.length)
    signal chosen(var choice)
    spacing: Style.space(6)

    Repeater {
      model: rowRoot.choices

      delegate: KeyButton {
        required property var modelData
        width: (rowRoot.width - (rowRoot.columns - 1) * rowRoot.spacing) / rowRoot.columns
        text: modelData.label || ""
        iconText: modelData.icon || ""
        active: modelData.active === true
        enabled: modelData.enabled !== false
        bordered: true
        foreground: root.foreground
        fontFamily: root.fontFamily
        fontSize: Style.font.bodySmall
        onClicked: rowRoot.chosen(modelData)
      }
    }
  }

  component SectionLabel: PlainText {
    color: root.dimColor
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    font.bold: true
  }

  // The controls popup for one tile, drawn in place of the grid: what the widget's own controls
  // dialog offers, applied as you drag.
  component ControlsView: Column {
    id: view
    readonly property var tile: root.controlsTile
    readonly property var ctl: root.controlState
    readonly property string kind: ctl ? ctl.kind : ""
    spacing: Style.space(12)

    // The keyboard model. Until Down is pressed the arrows and Enter act on the tile as a whole
    // (Left and Right move its main slider, Enter switches it), as they always have. Down then walks
    // a ring through the controls row by row: a slider (Left and Right move it), a button, a colour.
    // Enter presses the one it is on, and Up from the first row hands back to the tile. The place
    // is kept as a row and a column rather than as an item, because a change rebuilds the buttons
    // (the preset that was just pressed is a new object a moment later).
    property int stopRow: -1
    property int stopCol: 0
    // Where the ring is drawn, in the coordinates of ringHost (the scrolled content).
    property Item ringHost: null
    property rect ringRect: Qt.rect(0, 0, 0, 0)

    // Changes can only be made while the widget is connected to Home Assistant and the bar is
    // connected to the widget. Otherwise the controls say so instead of moving without effect.
    readonly property bool live: root.connected && root.socketConnected

    // What was just asked of Home Assistant, shown until it reports back (or a few seconds pass), so
    // a press is not taken for a dead button, and a second press of a stepper builds on the first
    // instead of repeating it.
    property var pending: ({})

    function shown(key, reported) {
      return pending[key] !== undefined ? pending[key] : reported
    }

    function ask(key, value) {
      var next = ({})
      Object.keys(pending).forEach(function(existing) { next[existing] = pending[existing] })
      next[key] = value
      pending = next
      pendingTimer.restart()
    }

    function reportedValue(key) {
      if (!ctl) return undefined
      if (key === "power") return ctl.on
      if (key === "mode") return ctl.mode
      if (key === "target") return ctl.target
      if (key === "playing") return ctl.playing
      if (key === "muted") return ctl.muted
      return undefined
    }

    // Drop what Home Assistant has now confirmed.
    function reconcilePending() {
      var keys = Object.keys(pending)
      if (keys.length === 0) return
      var next = ({})
      keys.forEach(function(key) {
        var asked = pending[key]
        var reported = reportedValue(key)
        var confirmed = typeof asked === "number" && typeof reported === "number"
          ? Math.abs(asked - reported) < 0.001
          : asked === reported
        if (!confirmed) next[key] = asked
      })
      pending = next
    }

    Timer {
      id: pendingTimer
      interval: 2500
      onTriggered: view.pending = ({})
    }

    function setPower(on) {
      ask("power", on)
      root.setControl("power", on)
    }

    function setMode(mode) {
      ask("mode", mode)
      root.setControl("mode", mode)
    }

    function setPlaying() {
      ask("playing", !shown("playing", ctl.playing))
      root.setControl("play_pause")
    }

    function setMuted() {
      var muted = !shown("muted", ctl.muted)
      ask("muted", muted)
      root.setControl("mute", muted)
    }

    onTileChanged: {
      clearStop()
      pending = ({})
    }
    onCtlChanged: {
      reconcilePending()
      Qt.callLater(revalidateStop)
    }
    onHeightChanged: Qt.callLater(syncRing)

    function collectStops(item, out) {
      var kids = item.children
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i]
        if (!kid.visible) continue
        if (kid.keyStop === true && kid.enabled !== false) out.push(kid)
        collectStops(kid, out)
      }
    }

    // The stops that can be reached now, in rows: a stop starts a new row when its centre is more
    // than 10px below the row's first, and each row runs left to right.
    function stopRows() {
      var all = []
      collectStops(view, all)
      var placed = all.map(function(item) {
        var at = item.mapToItem(view, 0, 0)
        return { item: item, x: at.x, cy: at.y + item.height / 2 }
      })
      placed.sort(function(a, b) { return a.cy - b.cy || a.x - b.x })
      var rows = []
      var rowTop = 0
      placed.forEach(function(entry) {
        if (rows.length === 0 || entry.cy - rowTop > 10) {
          rows.push([])
          rowTop = entry.cy
        }
        rows[rows.length - 1].push(entry)
      })
      return rows.map(function(row) {
        row.sort(function(a, b) { return a.x - b.x })
        return row.map(function(entry) { return entry.item })
      })
    }

    function currentStop(rows) {
      if (stopRow < 0 || stopRow >= rows.length) return null
      var row = rows[stopRow]
      return row[Math.min(stopCol, row.length - 1)]
    }

    function setStop(row, col) {
      stopRow = row
      stopCol = col
      syncRing()
      var rows = stopRows()
      root.ensureVisible(currentStop(rows))
    }

    function clearStop() {
      stopRow = -1
      stopCol = 0
      ringRect = Qt.rect(0, 0, 0, 0)
    }

    function syncRing() {
      var item = stopRow >= 0 && ringHost ? currentStop(stopRows()) : null
      if (!item) {
        ringRect = Qt.rect(0, 0, 0, 0)
        return
      }
      var at = item.mapToItem(ringHost, 0, 0)
      ringRect = Qt.rect(at.x, at.y, item.width, item.height)
    }

    // After the controls change: keep the ring on the same place, or drop it when the control it was
    // on is gone (a row that no longer exists).
    function revalidateStop() {
      if (stopRow < 0) return
      var rows = stopRows()
      if (rows.length === 0) {
        clearStop()
        return
      }
      stopRow = Math.min(stopRow, rows.length - 1)
      stopCol = Math.min(stopCol, rows[stopRow].length - 1)
      syncRing()
    }

    // The arrows. Up and Down change row; Left and Right move along a row of buttons or a row of
    // colours, and move a slider that has the ring.
    function move(dx, dy) {
      var rows = stopRows()
      if (dy !== 0) {
        var row = stopRow < 0 ? (dy > 0 ? 0 : -1) : stopRow + dy
        if (row < 0) clearStop()
        else if (row < rows.length) setStop(row, 0)
        return
      }
      var item = currentStop(rows)
      if (item && item.isSlider !== true) {
        var col = stopCol + dx
        if (col >= 0 && col < rows[stopRow].length) setStop(stopRow, col)
      } else if (!view.live) {
        // Offline the sliders are dimmed and setControl drops the request, so a nudge would only
        // look like a change for a moment.
        return
      } else if (item) {
        item.nudge(dx)
      } else {
        nudge(dx)
      }
    }

    // Enter: press the control the ring is on; with none, turn the light or fan on or off, or play
    // and pause.
    function activate() {
      // Offline the controls are dimmed: a press would show a change that is never sent.
      if (!view.live) return
      var item = stopRow >= 0 ? currentStop(stopRows()) : null
      if (item && item.isSlider !== true) {
        item.pressStop()
        return
      }
      if (!ctl) return
      if (kind === "light" || kind === "fan") setPower(!shown("power", ctl.on === true))
      else if (kind === "media") setPlaying()
    }

    // Left and right arrows with no control selected: the main slider.
    function nudge(direction) {
      if (kind === "light" && ctl.canSetBrightness) brightnessSlider.nudge(direction)
      else if (kind === "fan" && ctl.canSetPercentage) speedSlider.nudge(direction)
      else if (kind === "cover" && ctl.canSetPosition) positionSlider.nudge(direction)
      else if (kind === "media" && ctl.canSetVolume) volumeSlider.nudge(direction)
      else if (kind === "climate" && ctl.canSetTemperature) view.stepTemperature(direction)
    }

    function stepTemperature(direction) {
      var asked = shown("target", ctl.target)
      var current = asked !== null && asked !== undefined ? asked : ctl.min
      var next = Math.max(ctl.min, Math.min(ctl.max, Math.round((current + direction * ctl.step) * 100) / 100))
      ask("target", next)
      root.setControl("temperature", next)
    }

    // Header: back, the tile's icon and name, its status, and its power switch.
    Item {
      width: parent.width
      height: Math.max(headerText.implicitHeight, Style.space(32))

      PanelActionButton {
        id: backButton
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        iconText: "󰁍"
        tooltipText: root.word("back", "Back")
        foreground: root.foreground
        fontFamily: root.fontFamily
        onClicked: root.closeControls()
      }

      TileIcon {
        id: headerIcon
        anchors.left: backButton.right
        anchors.leftMargin: Style.space(6)
        anchors.verticalCenter: parent.verticalCenter
        width: Style.space(22)
        height: Style.space(22)
        icon: view.tile && view.tile.icon ? view.tile.icon : null
        color: view.tile && view.tile.active ? Color.accent : root.foreground
      }

      Column {
        id: headerText
        anchors.left: headerIcon.right
        anchors.leftMargin: Style.space(8)
        anchors.right: powerSwitch.visible ? powerSwitch.left : parent.right
        anchors.rightMargin: Style.space(8)
        anchors.verticalCenter: parent.verticalCenter
        spacing: Style.space(1)

        PlainText {
          width: parent.width
          text: view.tile ? view.tile.name : ""
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.title
          font.bold: true
          elide: Text.ElideRight
        }

        PlainText {
          width: parent.width
          visible: text !== ""
          text: Countdown.value(view.tile, root.now)
          color: root.dimColor
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          elide: Text.ElideRight
        }
      }

      ToggleSwitch {
        id: powerSwitch
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        visible: view.kind === "light" || view.kind === "fan"
        checked: view.shown("power", view.ctl ? view.ctl.on === true : false)
        enabled: view.live
        foreground: root.foreground
        onToggled: view.setPower(!checked)
      }
    }

    // Why nothing below responds, when it does not.
    PlainText {
      visible: !view.live
      width: parent.width
      text: !root.connected
        ? root.word("notConnectedControls", "Not connected to Home Assistant. Changes can't be sent right now.")
        : root.word("widgetUnreachableControls", "Can't reach the widget. Changes can't be sent right now.")
      color: Color.urgent
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
    }

    // Light: brightness, presets, colour temperature, colours.
    Column {
      visible: view.kind === "light"
      enabled: view.live
      opacity: view.live ? 1 : 0.45
      width: parent.width
      spacing: Style.space(10)

      ControlSlider {
        id: brightnessSlider
        visible: view.ctl && view.ctl.canSetBrightness === true
        width: parent.width
        label: root.word("brightness", "Brightness").toUpperCase()
        minimum: 1
        maximum: 100
        value: view.ctl && typeof view.ctl.brightness === "number" ? view.ctl.brightness : 0
        onValueSet: function(v) { root.setControl("brightness", v) }
      }

      ChoiceRow {
        visible: brightnessSlider.visible
        width: parent.width
        choices: [25, 50, 75, 100].map(function(level) {
          return { label: level + "%", value: level, active: Math.round(brightnessSlider.shownValue) === level }
        })
        onChosen: function(choice) { brightnessSlider.set(choice.value) }
      }

      ControlSlider {
        visible: view.ctl && view.ctl.colorTemp !== null && view.ctl.colorTemp !== undefined
        width: parent.width
        label: root.word("colorTemperature", "Color Temperature").toUpperCase()
        minimum: visible ? view.ctl.colorTemp.min : 2000
        maximum: visible ? view.ctl.colorTemp.max : 6500
        step: 50
        value: visible ? view.ctl.colorTemp.kelvin : 2000
        format: function(v) { return Math.round(v) + "K" }
        onValueSet: function(v) { root.setControl("color_temp", v) }
      }

      Column {
        visible: view.ctl && Array.isArray(view.ctl.colors) && view.ctl.colors.length > 0
        width: parent.width
        spacing: Style.space(6)

        SectionLabel { text: root.word("color", "Color").toUpperCase() }

        Row {
          spacing: Style.space(8)

          Repeater {
            model: view.ctl && Array.isArray(view.ctl.colors) ? view.ctl.colors : []

            delegate: Rectangle {
              required property string modelData
              property bool keyStop: true
              function pressStop() { root.setControl("color", modelData) }
              width: Style.space(28)
              height: Style.space(28)
              radius: width / 2
              color: modelData
              border.width: swatchMouse.containsMouse ? 2 : 1
              border.color: swatchMouse.containsMouse ? root.foreground : Util.alpha(root.foreground, 0.25)

              MouseArea {
                id: swatchMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: root.setControl("color", parent.modelData)
              }
            }
          }
        }
      }
    }

    // Fan: speed and presets.
    Column {
      visible: view.kind === "fan" && view.ctl.canSetPercentage === true
      enabled: view.live
      opacity: view.live ? 1 : 0.45
      width: parent.width
      spacing: Style.space(10)

      ControlSlider {
        id: speedSlider
        width: parent.width
        label: root.word("fanSpeed", "Fan Speed").toUpperCase()
        value: view.ctl && typeof view.ctl.percentage === "number" ? view.ctl.percentage : 0
        onValueSet: function(v) { root.setControl("percentage", v) }
      }

      ChoiceRow {
        width: parent.width
        choices: [
          { label: root.word("off", "Off"), value: 0 },
          { label: root.word("low", "Low"), value: 33 },
          { label: root.word("medium", "Medium"), value: 66 },
          { label: root.word("high", "High"), value: 100 }
        ].map(function(choice) {
          choice.active = Math.round(speedSlider.shownValue) === choice.value
          return choice
        })
        onChosen: function(choice) { speedSlider.set(choice.value) }
      }
    }

    // Cover: position, and open, stop, close.
    Column {
      visible: view.kind === "cover"
      enabled: view.live
      opacity: view.live ? 1 : 0.45
      width: parent.width
      spacing: Style.space(10)

      ControlSlider {
        id: positionSlider
        visible: view.ctl && view.ctl.canSetPosition === true
        width: parent.width
        label: root.word("position", "Position").toUpperCase()
        value: view.ctl && typeof view.ctl.position === "number" ? view.ctl.position : 0
        onValueSet: function(v) { root.setControl("position", v) }
      }

      ChoiceRow {
        width: parent.width
        choices: view.kind !== "cover" ? [] : [
          { label: root.word("open", "Open"), icon: "󰁝", command: "open", enabled: view.ctl.canOpen, active: view.ctl.state === "open" },
          { label: root.word("stop", "Stop"), icon: "󰓛", command: "stop", enabled: view.ctl.canStop },
          { label: root.word("close", "Close"), icon: "󰁅", command: "close", enabled: view.ctl.canClose, active: view.ctl.state === "closed" }
        ]
        onChosen: function(choice) { root.setControl(choice.command) }
      }
    }

    // Climate: target temperature and HVAC mode.
    Column {
      visible: view.kind === "climate"
      enabled: view.live
      opacity: view.live ? 1 : 0.45
      width: parent.width
      spacing: Style.space(10)

      Item {
        visible: view.ctl && view.ctl.canSetTemperature === true
        width: parent.width
        height: Style.space(56)

        KeyActionButton {
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          size: Style.space(40)
          bordered: true
          iconText: "󰍴"
          tooltipText: root.word("lower", "Lower")
          foreground: root.foreground
          fontFamily: root.fontFamily
          onClicked: view.stepTemperature(-1)
        }

        Column {
          anchors.centerIn: parent

          PlainText {
            anchors.horizontalCenter: parent.horizontalCenter
            text: view.kind === "climate" ? root.formatTemperature(view.shown("target", view.ctl.target)) : ""
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.displayLarge
            font.bold: true
          }

          PlainText {
            anchors.horizontalCenter: parent.horizontalCenter
            visible: view.kind === "climate" && view.ctl.current !== null
            text: view.kind === "climate" ? root.word("now", "Now {{temperature}}").replace("{{temperature}}", root.formatTemperature(view.ctl.current)) : ""
            color: root.dimColor
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }

        KeyActionButton {
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          size: Style.space(40)
          bordered: true
          iconText: "󰐕"
          tooltipText: root.word("raise", "Raise")
          foreground: root.foreground
          fontFamily: root.fontFamily
          onClicked: view.stepTemperature(1)
        }
      }

      // A thermostat in heat/cool mode has two setpoints rather than one target: shown, not changed
      // here (the widget's own controls set the range).
      Column {
        visible: view.kind === "climate" && !view.ctl.canSetTemperature
        width: parent.width
        spacing: Style.space(2)

        PlainText {
          anchors.horizontalCenter: parent.horizontalCenter
          text: view.kind !== "climate" ? ""
            : (view.ctl.targetLow !== null && view.ctl.targetHigh !== null
              ? root.formatTemperature(view.ctl.targetLow) + " – " + root.formatTemperature(view.ctl.targetHigh)
              : root.formatTemperature(view.ctl.current))
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.displayLarge
          font.bold: true
        }

        PlainText {
          anchors.horizontalCenter: parent.horizontalCenter
          visible: view.kind === "climate" && view.ctl.current !== null
            && view.ctl.targetLow !== null && view.ctl.targetHigh !== null
          text: view.kind === "climate" ? root.word("now", "Now {{temperature}}").replace("{{temperature}}", root.formatTemperature(view.ctl.current)) : ""
          color: root.dimColor
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }

        PlainText {
          anchors.horizontalCenter: parent.horizontalCenter
          visible: view.kind === "climate" && view.ctl.targetLow !== null && view.ctl.targetHigh !== null
          text: root.word("setRange", "Set the range in the widget.")
          color: root.dimColor
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }

      SectionLabel {
        visible: view.kind === "climate" && view.ctl.modes.length > 0
        text: root.word("mode", "Mode").toUpperCase()
      }

      Flow {
        visible: view.kind === "climate" && view.ctl.modes.length > 0
        width: parent.width
        spacing: Style.space(6)

        Repeater {
          model: view.kind === "climate" ? view.ctl.modes : []

          delegate: KeyButton {
            required property string modelData
            text: root.modeLabel(modelData)
            active: view.shown("mode", view.ctl.mode) === modelData
            bordered: true
            foreground: root.foreground
            fontFamily: root.fontFamily
            fontSize: Style.font.bodySmall
            onClicked: view.setMode(modelData)
          }
        }
      }
    }

    // Media: what is playing, transport, volume.
    Column {
      visible: view.kind === "media"
      enabled: view.live
      opacity: view.live ? 1 : 0.45
      width: parent.width
      spacing: Style.space(10)

      Column {
        visible: view.kind === "media" && view.ctl.title !== ""
        width: parent.width
        spacing: Style.space(2)

        PlainText {
          width: parent.width
          text: view.kind === "media" ? view.ctl.title : ""
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          font.bold: true
          elide: Text.ElideRight
        }

        PlainText {
          width: parent.width
          visible: text !== ""
          text: view.kind === "media" ? view.ctl.artist : ""
          color: root.dimColor
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          elide: Text.ElideRight
        }
      }

      ChoiceRow {
        width: parent.width
        choices: view.kind !== "media" ? [] : [
          { icon: "󰒮", command: "previous", enabled: view.ctl.canPrevious },
          {
            icon: view.shown("playing", view.ctl.playing) ? "󰏤" : "󰐊",
            command: "play_pause",
            enabled: view.shown("playing", view.ctl.playing) ? view.ctl.canPause : view.ctl.canPlay,
            active: view.shown("playing", view.ctl.playing)
          },
          { icon: "󰒭", command: "next", enabled: view.ctl.canNext }
        ]
        onChosen: function(choice) {
          if (choice.command === "play_pause") view.setPlaying()
          else root.setControl(choice.command)
        }
      }

      Row {
        visible: view.kind === "media" && (view.ctl.canSetVolume || view.ctl.canMute)
        width: parent.width
        spacing: Style.space(8)

        KeyActionButton {
          id: muteButton
          anchors.bottom: parent.bottom
          visible: view.kind === "media" && view.ctl.canMute
          iconText: view.kind === "media" && view.shown("muted", view.ctl.muted) ? "󰖁" : "󰕾"
          tooltipText: view.kind === "media" && view.shown("muted", view.ctl.muted) ? root.word("unmute", "Unmute") : root.word("mute", "Mute")
          foreground: root.foreground
          fontFamily: root.fontFamily
          onClicked: view.setMuted()
        }

        ControlSlider {
          id: volumeSlider
          visible: view.kind === "media" && view.ctl.canSetVolume
          width: parent.width - (muteButton.visible ? muteButton.width + parent.spacing : 0)
          label: root.word("volume", "Volume").toUpperCase()
          value: view.kind === "media" && typeof view.ctl.volume === "number" ? view.ctl.volume : 0
          onValueSet: function(v) { root.setControl("volume", v) }
        }
      }
    }

    // Everything else the widget's own dialog has.
    KeyButton {
      width: parent.width
      text: root.word("openInWidget", "Open in widget")
      iconText: "󰏌"
      bordered: true
      foreground: root.foreground
      fontFamily: root.fontFamily
      fontSize: Style.font.bodySmall
      onClicked: root.openInWidget(view.tile)
    }
  }
}
