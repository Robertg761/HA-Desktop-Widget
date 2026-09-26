import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

// Home Assistant in the Omarchy bar. HA Desktop Widget publishes its connection state and the
// chosen entities to $XDG_RUNTIME_DIR/ha-desktop-widget/omarchy-bar.json; this widget only
// reads that file and runs the widget's command line for actions, so no Home Assistant
// credentials ever reach the shell.
//
// Settings, inline on this widget's entry in ~/.config/omarchy/shell.json:
//   "entities":    entity ids listed in the panel (default: the widget's Quick Access favorites)
//   "barEntities": up to four entity ids whose values are shown in the bar itself
//   "command":     the widget's command when it is not running (default: ha-desktop-widget)
Panel {
  id: root
  moduleName: "com.github.robertg761.hadesktopwidget"
  ipcTarget: "com.github.robertg761.hadesktopwidget"
  manageIpc: false

  readonly property string statusPath: {
    var runtimeDir = Quickshell.env("XDG_RUNTIME_DIR")
    return runtimeDir ? runtimeDir + "/ha-desktop-widget/omarchy-bar.json" : ""
  }
  // Written by the widget on start and kept after it quits, so the bar can start it again even
  // when it is an AppImage with no ha-desktop-widget command on PATH.
  readonly property string launchPath: {
    var stateHome = Quickshell.env("XDG_STATE_HOME") || (Quickshell.env("HOME") + "/.local/state")
    return stateHome + "/ha-desktop-widget/omarchy-bar-launch.json"
  }
  // The widget rewrites the file every minute; older than this means it is not running.
  readonly property int staleAfterMs: 150000

  property var status: null
  property var savedLaunch: null
  property double now: Date.now()

  readonly property bool running: status !== null && now - status.updatedAt < staleAfterMs
  readonly property bool connected: running && status.connection === "connected"
  readonly property var panelEntities: running && Array.isArray(status.panel) ? status.panel : []
  readonly property var barEntities: running && Array.isArray(status.bar) ? status.bar : []
  readonly property string barText: barEntities
    .filter(function(entity) { return entity.value !== "" })
    .map(function(entity) { return entity.value })
    .join("  ")

  readonly property color textColor: Color.popups.text
  readonly property color dimColor: Qt.darker(Color.popups.text, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  function statusLine() {
    if (!running) return "HA Desktop Widget is not running"
    if (status.connection === "connected") return "Connected"
    if (status.connection === "auth-failed") return "Sign-in needed. Open the widget to reconnect."
    if (status.connection === "connecting") return "Connecting…"
    return "Disconnected. Retrying automatically."
  }

  // Runs the widget's own command line. A running widget receives it through its
  // single-instance handler; otherwise the command starts the widget.
  function launch(extraArgs) {
    var argv = running && Array.isArray(status.launch) && status.launch.length > 0
      ? status.launch.slice()
      : Array.isArray(savedLaunch) && savedLaunch.length > 0
        ? savedLaunch.slice()
        : [String(setting("command", "ha-desktop-widget"))]
    Quickshell.execDetached(argv.concat(extraArgs))
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

  function toggleEntity(entityId) {
    launch(["--entity-toggle=" + entityId])
  }

  function applyStatus(text) {
    try {
      var parsed = JSON.parse(text)
      root.status = parsed && parsed.version === 1 ? parsed : null
    } catch (error) {
      root.status = null
    }
    root.now = Date.now()
  }

  onOpenedChanged: if (opened) Qt.callLater(function() { keyCatcher.forceActiveFocus() })

  FileView {
    id: statusFile
    path: root.statusPath
    watchChanges: true
    // Absent whenever the widget is not running.
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.applyStatus(text())
    onLoadFailed: root.status = null
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

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.barText !== "" ? "󰟐  " + root.barText : "󰟐"
    dimmed: !root.connected
    tooltipText: root.running ? "Home Assistant: " + root.statusLine() : root.statusLine()
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.RightButton || buttonCode === Qt.MiddleButton) root.toggleWidget()
      else if (!root.running || root.panelEntities.length === 0) root.toggleWidget()
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
    contentWidth: panel.fittedContentWidth(Style.space(320))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(520))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Flickable {
        id: flick
        anchors.fill: parent
        contentHeight: column.implicitHeight
        clip: true

        Column {
          id: column
          width: flick.width
          spacing: Style.space(4)

          Text {
            width: parent.width
            text: "Home Assistant"
            color: root.textColor
            font.family: root.fontFamily
            font.pixelSize: Style.font.title
            font.bold: true
          }

          Text {
            width: parent.width
            bottomPadding: Style.space(6)
            text: root.statusLine()
            color: root.dimColor
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          Repeater {
            model: root.panelEntities

            delegate: Rectangle {
              id: row
              required property var modelData
              width: column.width
              height: Style.space(30)
              radius: Style.cornerRadius
              color: rowMouse.containsMouse && modelData.toggleable ? Style.hoverFill : "transparent"

              Text {
                anchors.left: parent.left
                anchors.leftMargin: Style.space(8)
                anchors.right: valueText.left
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                text: row.modelData.name
                color: row.modelData.available ? root.textColor : root.dimColor
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                elide: Text.ElideRight
              }

              Text {
                id: valueText
                anchors.right: parent.right
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                text: row.modelData.value
                color: row.modelData.active ? Color.accent : root.dimColor
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
              }

              MouseArea {
                id: rowMouse
                anchors.fill: parent
                hoverEnabled: true
                enabled: row.modelData.toggleable
                cursorShape: row.modelData.toggleable ? Qt.PointingHandCursor : Qt.ArrowCursor
                onClicked: root.toggleEntity(row.modelData.id)
              }
            }
          }

          Rectangle {
            width: column.width
            height: Style.space(30)
            radius: Style.cornerRadius
            color: openMouse.containsMouse ? Style.hoverFill : "transparent"

            Text {
              anchors.left: parent.left
              anchors.leftMargin: Style.space(8)
              anchors.verticalCenter: parent.verticalCenter
              text: "Open HA Desktop Widget"
              color: Color.accent
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
            }

            MouseArea {
              id: openMouse
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onClicked: root.toggleWidget()
            }
          }
        }
      }
    }
  }
}
