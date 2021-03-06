// Phantombuster configuration {
"phantombuster command: nodejs"
"phantombuster package: 5"
"phantombuster dependencies: lib-StoreUtilities.js, lib-LinkedIn.js, lib-LinkedInScraper-DEV.js"

const fs = require("fs")
const Papa = require("papaparse")
const needle = require("needle")

const Buster = require("phantombuster")
const buster = new Buster()

const Nick = require("nickjs")
const nick = new Nick({
	loadImages: true,
	printPageErrors: false,
	printRessourceErrors: false,
	printNavigation: false,
	printAborts: false,
})

const StoreUtilities = require("./lib-StoreUtilities")
const utils = new StoreUtilities(nick, buster)
const LinkedIn = require("./lib-LinkedIn")
const linkedIn = new LinkedIn(nick, buster, utils)
const LinkedInScraper = require("./lib-LinkedInScraper-DEV")
const DB_NAME = "linkedin-profile-visitor.csv"
const DEFAULT_VISIT_COUNT = 1
let db
// }

const getDb = async () => {
	const resp = await needle("GET", `https://phantombuster.com/api/v1/agent/${buster.agentId}`, {}, { headers: {
		"X-Phantombuster-Key-1": buster.apiKey }
	})
	if (resp.body && resp.body.status === "success" && resp.body.data.awsFolder && resp.body.data.userAwsFolder) {
		const url = `https://phantombuster.s3.amazonaws.com/${resp.body.data.userAwsFolder}/${resp.body.data.awsFolder}/${DB_NAME}`
		try {
			await buster.download(url, DB_NAME)
			const file = fs.readFileSync(DB_NAME, "UTF-8")
			const data = Papa.parse(file, { header: true }).data
			return data
		} catch (err) {
			return []
		}
	} else {
		throw "Could not load bot database."
	}
}

const checkDb = (str, db) => {
	for (const line of db) {
		if (str === line.profileLink || line.profileLink.startsWith(str)) {
			return false
		}
	}
	return true
}

const getUrlsToScrape = (data, numberOfVisitsPerLaunch) => {
	data = data.filter((item, pos) => data.indexOf(item) === pos)
	let i = 0
	const urls = []
	const maxLength = data.length
	if (maxLength === 0) {
		utils.log("Spreadsheet is empty or everyone is already added from this sheet.", "warning")
		nick.exit()
	}

	while (i < numberOfVisitsPerLaunch && i < maxLength) {
		const row = Math.floor(Math.random() * data.length)
		urls.push(data[row].trim())
		data.splice(row, 1)
		i++
	}
	return urls
}

;(async () => {
	db = await getDb()
	const tab = await nick.newTab()
	const linkedInScraper = new LinkedInScraper(utils)
	let { sessionCookie, spreadsheetUrl, columnName, numberOfVisitsPerLaunch, profileUrls } = utils.validateArguments()
	let urls

	if (typeof profileUrls === "string") {
		urls = [ profileUrls ]
	} else if (Array.isArray(profileUrls)) {
		urls = [ profileUrls ]
	}
	
	if (spreadsheetUrl) {
		urls = await utils.getDataFromCsv(spreadsheetUrl.trim(), columnName)
	}

	if (!numberOfVisitsPerLaunch) {
		numberOfVisitsPerLaunch = DEFAULT_VISIT_COUNT
	}

	urls = getUrlsToScrape(urls.filter(str => checkDb(str, db)), numberOfVisitsPerLaunch)
	await linkedIn.login(tab, sessionCookie)
	for (const url of urls) {
		utils.log(`Visiting ${url} ...`, "loading")
		const timeLeft = await utils.checkTimeLeft()
		if (!timeLeft.timeLeft) {
			utils.log(`Stopped visiting profiles: ${timeLeft.message}`, "warning")
			break
		}
		try {
			await linkedInScraper.visitProfile(tab, url)
		} catch (err) {
			utils.log(`Could not visit ${url}, due to: ${err.message || err}`, "warning")
			utils.log(`Dumping stack error: ${err.stack || ""}`, "warning")
		} finally {
			db.push({ profileLink: url })
		}
	}
	await buster.saveText(Papa.unparse(db), DB_NAME)
	nick.exit(0)
})()
	.catch(err => {
		utils.log(err.message || err, "error")
		nick.exit(1)
	})
