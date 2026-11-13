// The one door between the web page and Node. Page gets these 4 functions, nothing else.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("corral", {
	pickRepo: () => ipcRenderer.invoke("pick-repo"),
	newThread: (repo, task, size) => ipcRenderer.invoke("new-thread", { repo, task, size }),
	listPens: (repo) => ipcRenderer.invoke("list-pens", repo),
	resume: (meta, size) => ipcRenderer.invoke("resume", { meta, size }),
	kill: (id) => ipcRenderer.invoke("kill", id),
	merge: (args) => ipcRenderer.invoke("merge", args),
	openPr: (args) => ipcRenderer.invoke("open-pr", args),
	deletePen: (args) => ipcRenderer.invoke("delete-pen", args),
	files: (pen) => ipcRenderer.invoke("files", pen),
	send: (id, text) => ipcRenderer.send("in", { id, text }),
	resize: (id, cols, rows) => ipcRenderer.send("resize", { id, cols, rows }),
	on: (channel, fn) => {
		const h = (_e, data) => fn(data);
		ipcRenderer.on(channel, h);
		return () => ipcRenderer.off(channel, h);
	},
});
