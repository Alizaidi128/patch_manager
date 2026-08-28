const { contextBridge, ipcRenderer } = require('electron')
const { version } = require('./package.json')

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => {
    ipcRenderer.on(channel, (_, ...args) => listener(...args))
    return () => ipcRenderer.removeAllListeners(channel)
  },
  appVersion: version
})
