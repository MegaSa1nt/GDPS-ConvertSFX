// Stole convert code from https://shashwatv.com/parse-audio-to-ogg-opus-telegram/
const fs = require('node:fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const express = require('express');
const multer  = require('multer');
const upload = multer({dest: 'temp/'});
const axios = require('axios');
const FormData = require('form-data');
var methodOverride = require('method-override');
var config = require('./config.json');
var isConverting = false;
var songsQueue = Object.assign({}, []);
fs.stat('queue.json', (err, stat) => {
	if(err == null) {
		fs.readFile('queue.json', 'utf8', (err, data) => {
			if(err) console.error('[SFX] Failed reading queue.json!\n' + err);
			try {
				songsQueue = Object.assign({}, JSON.parse(data));
			} catch(e) {
				console.error(' \n[SFX] Failed parsing queue.json!');
			}
			if(Object.keys(songsQueue).length > 0) {
				console.log(' \n[SFX] Found unconverted SFXs! (' + Object.keys(songsQueue).length + ')');
				checkQueue();
			}
		});
	}
});


const app = express();

ffmpeg.setFfmpegPath(ffmpegPath);

app.get('/', (req, res) => {
	fs.readFile('res/index.html', 'utf8', (err, data) => {
		if(err || !data.length) html = '<h1>Привет!</h1>!';
		else html = data;
		res.send(data);
	})
});

app.post('/convert', upload.single('file'), (req, res) => {
	song = req.body;
	if(!checkQuery(req)) {
		console.error(' \n[SFX] SFX convert request error: Invalid params');
		return res.json({success: false, code: 0, error: 'Invalid params.'});
	}
	console.log(' \n[SFX] New SFX convert request: ');
	console.log('File name: ' + song.name + ',\nServer: ' + song.server + ',\nSize: ' + (req.file.size / 1024 / 1024).toFixed(2) + ' MB');
	if(req.file.size > config.maxFileSize * 1024 * 1024) {
		console.error(' \n[SFX] SFX convert request error: Max file size is ' + config.maxFileSize + ' megabytes');
		console.log('File name: ' + song.name + ',\nServer: ' + song.server + ',\nSize: ' + (req.file.size / 1024 / 1024).toFixed(2) + ' MB');
		return res.json({success: false, code: 0, error: 'Max file size is ' + config.maxFileSize + ' megabytes.'});
	}
	if(songsQueue.hasOwnProperty(song.token)) {
		console.error(' \n[SFX] SFX convert request error: Token already exists');
		console.log('File name: ' + song.name + ',\nServer: ' + song.server + ',\nSize: ' + (req.file.size / 1024 / 1024).toFixed(2) + ' MB');
		return res.json({success: false, code: 2, error: 'Token already exists.'});
	}
	fs.rename(req.file.path, __dirname + '/temp/' + song.token + '_temp.ogg', () => {
		songsQueue[song.token] = {name: song.name, server: song.server, token: song.token, size: req.file.size};
		fs.writeFile('queue.json', JSON.stringify(songsQueue, null, 2), () => {});
		if(!isConverting) checkQueue();
		res.json({success: true});
	});
});

function checkQueue() {
	if(Object.keys(songsQueue).length > 0) {
		song = songsQueue[Object.keys(songsQueue)[0]];
		delete songsQueue[Object.keys(songsQueue)[0]];
		convert(song);
	}
}
function convert(song) {
	return new Promise((r) => {
		isConverting = true;
		oldPath = __dirname + '/temp/' + song.token + '_temp.ogg';
		oggFilePath = __dirname + '/temp/' + song.token + '.ogg';
		try {
			console.log(' \n[SFX] Converting ' + song.name + ' from ' + song.server + '...');
			ffmpeg().input(oldPath).on('error', function(err) {
				console.error(' \n[SFX] Failed converting SFX!\n' + err.message);
				console.log('File name: ' + song.name + ',\nServer: ' + song.server + ',\nSize: ' + (song.size / 1024 / 1024).toFixed(2) + ' MB');
				fs.unlink(oldPath, () => {});
				fs.unlink(oggFilePath, () => {});
				checkQueue();
				r(false);
			}).outputOptions('-c:a libvorbis').output(oggFilePath).on('end', () => {
				fs.readFile(oggFilePath, (err, convertedSong) => {
					if(err) {
						fs.stat(oldPath, (e, stat) => {
							if(e != null) {
								console.error(' \n[SFX] Failed saving converted SFX!\n' + err);
								console.log('File name: ' + song.name + ',\nServer: ' + song.server + ',\nSize: ' + (song.size / 1024 / 1024).toFixed(2) + ' MB');
								checkQueue();
								r(false);
							} else {
								console.log(' \n[SFX] Converting ' + song.name + ' from ' + song.server + ' failed! Trying again...');
								convert(song);
								checkQueue();
								r(false);
							}
						});
					} else {
						isConverting = false;
						fs.writeFile('queue.json', JSON.stringify(songsQueue, null, 2), () => {});
						console.log(' \n[SFX] Successfully converted ' + song.name + ' from ' + song.server + ' to .ogg, ' + Object.keys(songsQueue).length + ' left');
						fs.unlink(oldPath, () => {});
						form = new FormData();
						form.append('token', song.token);
						form.append('file', convertedSong, song.name);
						axios.post(song.server + 'update.php', form, {headers: {'Content-Type': 'multipart/form-data'}})
						.then(res => {
							response = res.data;
							if(!response.success) {
								console.error(' \n[SFX] Failed sending converted SFX to the server!\n \n' + response.error + ' (' + response.code + ')');
								console.log(' \n \nServer response: ', res.data);
								console.log('File name: ' + song.name + ',\nServer: ' + song.server + ',\nSize: ' + (song.size / 1024 / 1024).toFixed(2) + ' MB');
							}
							fs.unlink(oggFilePath, () => {});
							checkQueue();
							r(true);
						}).catch(err => {
							console.error(' \n[SFX] Failed sending converted SFX to the server!\n \n' + err.message);
							console.log('File name: ' + song.name + ',\nServer: ' + song.server + ',\nSize: ' + (song.size / 1024 / 1024).toFixed(2) + ' MB');
							fs.unlink(oggFilePath, () => {});
							checkQueue();
							r(false);
						});
					}
				});
			}).run();
		} catch(err) {
			console.error(' \n[SFX] Failed running FFmpeg!\n' + err.message);
			console.log('File name: ' + song.name + ',\nServer: ' + song.server + ',\nSize: ' + (song.size / 1024 / 1024).toFixed(2) + ' MB');
			fs.unlink(oldPath, () => {});
			checkQueue();
			r(false);
		}
	});
}
function checkQuery(song) {
	if((typeof song.body.name == 'undefined' || !song.body.name.length) ||
	(typeof song.body.server == 'undefined' || !song.body.server.length) ||
	(typeof song.body.token == 'undefined' || !song.body.token.length) ||
	(typeof song.file == 'undefined') || config.mode == config.domainlist.includes(song.body.server.split('://')[1].split('/')[0]) ||
	(song.file.mimetype != "audio/mpeg" && song.file.mimetype != "audio/mp3")) return false;
	return true;
}

app.use(methodOverride());
app.use('/res', express.static(__dirname + '/res'));

app.listen(config.port, () => {
	console.log('[SFX] SFX converter is running at port ' + config.port + '!');
});