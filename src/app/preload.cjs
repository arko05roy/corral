// The one door between the web page and Node. Page gets these 4 functions, nothing else.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("corral", {
	pickRepo: () => ipcRenderer.invoke("pick-repo"),
	newThread: (repo, task) => ipcRenderer.invoke("new-thread", { repo, task }),
	listPens: (repo) => ipcRenderer.invoke("list-pens", repo),
	resume: (meta) => ipcRenderer.invoke("resume", meta),
	files: (pen) => ipcRenderer.invoke("files", pen),
	send: (id, text) => ipcRenderer.send("in", { id, text }),
	resize: (id, cols, rows) => ipcRenderer.send("resize", { id, cols, rows }),
	on: (channel, fn) => {
		const h = (_e, data) => fn(data);
		ipcRenderer.on(channel, h);
		return () => ipcRenderer.off(channel, h);
	},
});
