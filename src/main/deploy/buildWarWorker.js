const { workerData, parentPort } = require('worker_threads')
const AdmZip = require('adm-zip')
const fs     = require('fs')
const path   = require('path')

const zip     = new AdmZip()
const entries = fs.readdirSync(workerData.src, { withFileTypes: true })
for (const entry of entries) {
  if (entry.isDirectory()) {
    zip.addLocalFolder(path.join(workerData.src, entry.name), entry.name)
  }
}
zip.writeZip(workerData.out)
parentPort.postMessage('done')
