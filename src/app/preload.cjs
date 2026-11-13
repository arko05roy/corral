// The one door between the web page and Node. Page gets these 4 functions, nothing else.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("corral", {
	pickRepo: () => ipcRenderer.invoke("pick-repo"),
	newThread: (repo, task, size) => ipcRenderer.invoke("new-thread", { repo, task, size }),
	listPens: (repo) => ipcRenderer.invoke("list-pens", repo),
	resume: (meta, size) => ipcRenderer.invoke("resume", { meta, size }),
	newShell: (cwd, size) => ipcRenderer.invoke("new-shell", { cwd, size }),
	hostname: () => ipcRenderer.invoke("hostname"),
	kill: (id) => ipcRenderer.invoke("kill", id),
	merge: (args) => ipcRenderer.invoke("merge", args),
	openPr: (args) => ipcRenderer.invoke("open-pr", args),
	deletePen: (args) => ipcRenderer.invoke("delete-pen", args),
	files: (pen) => ipcRenderer.invoke("files", pen),
	readFile: (pen, path) => ipcRenderer.invoke("read-file", { pen, path }),
	readBase: (pen, path) => ipcRenderer.invoke("read-base", { pen, path }),
	gitInfo: (pen) => ipcRenderer.invoke("git-info", pen),
	gitRun: (pen, action, fields) => ipcRenderer.invoke("git-run", { pen, action, fields }),
	gitAiMessage: (pen) => ipcRenderer.invoke("git-ai-message", pen),
	prList: (pen, state) => ipcRenderer.invoke("pr-list", { pen, state }),
	prView: (pen, num) => ipcRenderer.invoke("pr-view", { pen, num }),
	prForBranch: (pen) => ipcRenderer.invoke("pr-for-branch", pen),
	prMerge: (pen, num, method, deleteBranch) => ipcRenderer.invoke("pr-merge", { pen, num, method, deleteBranch }),
	prAct: (pen, num, act, body) => ipcRenderer.invoke("pr-act", { pen, num, act, body }),
	prCleanup: (args) => ipcRenderer.invoke("pr-cleanup", args),
	openUrl: (url) => ipcRenderer.invoke("open-url", url),
	repoInfo: (repo) => ipcRenderer.invoke("repo-info", repo),
	repoInit: (repo) => ipcRenderer.invoke("repo-init", repo),
	repoGitHub: (repo, name, visibility) => ipcRenderer.invoke("repo-github", { repo, name, visibility }),
	send: (id, text) => ipcRenderer.send("in", { id, text }),
	resize: (id, cols, rows) => ipcRenderer.send("resize", { id, cols, rows }),
	on: (channel, fn) => {
		const h = (_e, data) => fn(data);
		ipcRenderer.on(channel, h);
		return () => ipcRenderer.off(channel, h);
	},
});
