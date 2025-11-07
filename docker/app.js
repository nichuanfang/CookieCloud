const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const fetch = require('node-fetch');

const cors = require('cors');
app.use(cors());

const data_dir = path.join(__dirname, 'data');
// make dir if not exist
if (!fs.existsSync(data_dir)) fs.mkdirSync(data_dir, {recursive: true});

const multer = require('multer');
const forms = multer({limits: {fieldSize: 100 * 1024 * 1024}});
app.use(forms.array());

app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({extended: true}));

const api_root = process.env.API_ROOT ? process.env.API_ROOT.trim().replace(/\/+$/, '') : '';

app.all(`${api_root}/`, (req, res) => {
    res.send('Hello World! API ROOT = ' + api_root);
});

// ---------------- /update ----------------
app.post(`${api_root}/update`, async (req, res) => {
    const {encrypted, uuid} = req.body;
    if (!encrypted || !uuid) {
        res.status(400).send('Bad Request');
        return;
    }

    const file_path = path.join(data_dir, path.basename(uuid) + '.json');
    const content = JSON.stringify({encrypted});

    try {
        fs.writeFileSync(file_path, content);
        const verify = fs.readFileSync(file_path, 'utf8');

        if (verify === content) {
            // 同步推送 webhook
            const webhookUrl = process.env.WEBHOOK_URL;
            if (webhookUrl) {
                try {
                    await fetch(webhookUrl, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            event: 'update_success',
                            uuid,
                            timestamp: new Date().toISOString()
                        })
                    });
                    console.log(`Webhook pushed to ${webhookUrl}`);
                } catch (err) {
                    console.error(`Webhook push failed: ${err.message}`);
                    res.status(500).send('Webhook push failed');
                    return;
                }
            }

            // 返回响应
            res.json({action: "done"});
        } else {
            res.json({action: "error"});
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Serverless Error');
    }
});

// ---------------- /get/:uuid ----------------
app.all(`${api_root}/get/:uuid`, (req, res) => {
    const {uuid} = req.params;
    if (!uuid) {
        res.status(400).send('Bad Request');
        return;
    }

    const file_path = path.join(data_dir, path.basename(uuid) + '.json');
    if (!fs.existsSync(file_path)) {
        res.status(404).send('Not Found');
        return;
    }

    const data = JSON.parse(fs.readFileSync(file_path, 'utf8'));
    if (!data) {
        res.status(500).send('Internal Serverless Error');
        return;
    }

    if (req.body.password) {
        try {
            const parsed = cookie_decrypt(uuid, data.encrypted, req.body.password);
            res.json(parsed);
        } catch (err) {
            console.error(err);
            res.status(400).send('Decrypt failed');
        }
    } else {
        res.json(data);
    }
});

// ---------------- 错误处理中间件 ----------------
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send('Internal Serverless Error');
});

// ---------------- 启动服务 ----------------
const port = 8088;
app.listen(port, () => {
    console.log(`Server start on http://localhost:${port}${api_root}`);
});

// ---------------- 解密函数 ----------------
function cookie_decrypt(uuid, encrypted, password) {
    const CryptoJS = require('crypto-js');
    const the_key = CryptoJS.MD5(uuid + '-' + password).toString().substring(0, 16);
    const decrypted = CryptoJS.AES.decrypt(encrypted, the_key).toString(CryptoJS.enc.Utf8);
    return JSON.parse(decrypted);
}
