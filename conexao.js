const firebird = require('node-firebird');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs'); // Certifique-se de instalar com `npm install exceljs`
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads'); // Import Worker and related functions
const readline = require('readline'); // Import readline for user input
const ini = require('ini'); // Import ini for reading .cfg files

// Function to read configuration from .cfg file
const readConfig = (filePath) => {
    if (!fs.existsSync(filePath)) {
        console.error(`Arquivo de configuração não encontrado: ${filePath}`);
        process.exit(1);
    }
    const configFile = fs.readFileSync(filePath, 'utf-8');
    return ini.parse(configFile);
};

const config = readConfig('config.cfg'); // Read the configuration from config.cfg

const options = {
    host: config.database.host,
    port: config.database.port,
    database: config.database.path.replace(/\\/g, '/'), // Replace backslashes with forward slashes
    user: config.database.user,
    password: config.database.password,
    charset: config.database.charset,
};

// Função para gerar o nome do arquivo com data e hora
const gerarNomeArquivo = (extensao, pasta, tableName) => {
    const agora = new Date();
    const dataHora = agora.toISOString().replace(/[-T:.]/g, '').slice(0, 14);
    return path.join(pasta, `${tableName}_${dataHora}.${extensao}`);
};

if (isMainThread) {
    // Main thread code
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question('Digite a quantidade de tabelas para exportar: ', (numTables) => {
        const tableNames = [];
        let count = 0;

        const askTableName = () => {
            if (count < numTables) {
                rl.question(`Digite o nome da tabela ${count + 1}: `, (tableName) => {
                    tableNames.push(tableName);
                    count++;
                    askTableName();
                });
            } else {
                console.log('Iniciando o processo de exportação...');

                const worker = new Worker(__filename, {
                    workerData: { tableNames } // Pass the table names to the worker
                });

                worker.on('message', (message) => {
                    console.log(message);
                });

                worker.on('error', (error) => {
                    console.error('Erro no worker:', error);
                });

                worker.on('exit', (code) => {
                    if (code !== 0) {
                        console.error(`Worker parou com o código de saída ${code}`);
                    } else {
                        console.log('Processo de exportação concluído. Pressione Enter para sair.');
                    }
                    rl.question('', () => rl.close()); // Wait for user to press Enter
                });
            }
        };

        askTableName();
    });
} else {
    // Worker thread code
    const tableNames = workerData.tableNames;

    const exportTable = (tableName, callback) => {
        firebird.attach(options, (err, db) => {
            if (err) {
                parentPort.postMessage('Erro ao conectar ao Firebird: ' + err.message);
                return callback(err);
            }
            parentPort.postMessage(`Conexão com o Firebird bem-sucedida para a tabela ${tableName}!`);

            // Executar uma consulta simples
            db.query(`SELECT * FROM ${tableName}`, (err, result) => {
                if (err) {
                    parentPort.postMessage('Erro ao executar consulta: ' + err.message);
                    db.detach();
                    return callback(err);
                } else {
                    parentPort.postMessage(`Resultado da consulta obtido para a tabela ${tableName}. Carregando...`);

                    // Exportar para JSON
                    const nomeJson = gerarNomeArquivo('json', 'JSON', tableName);
                    fs.mkdirSync('JSON', { recursive: true }); // Ensure the directory exists
                    fs.writeFileSync(nomeJson, JSON.stringify(result, null, 2), 'utf-8');
                    parentPort.postMessage(`Arquivo JSON salvo como: ${nomeJson}`);

                    // Exportar para Excel
                    const workbook = new ExcelJS.Workbook();
                    const worksheet = workbook.addWorksheet('Exportação');

                    // Adicionar cabeçalhos
                    if (result.length > 0) {
                        worksheet.columns = Object.keys(result[0]).map((key) => ({
                            header: key,
                            key: key,
                        }));

                        // Adicionar dados
                        result.forEach((row) => {
                            worksheet.addRow(row);
                        });

                        const nomeExcel = gerarNomeArquivo('xlsx', 'EXCEL', tableName);
                        fs.mkdirSync('EXCEL', { recursive: true }); // Ensure the directory exists
                        workbook.xlsx.writeFile(nomeExcel).then(() => {
                            parentPort.postMessage(`Arquivo Excel salvo como: ${nomeExcel}`);
                            db.detach();
                            callback(null);
                        });
                    } else {
                        parentPort.postMessage(`Nenhum dado encontrado na tabela ${tableName}.`);
                        db.detach();
                        callback(null);
                    }
                }
            });
        });
    };

    const exportAllTables = (index) => {
        if (index < tableNames.length) {
            exportTable(tableNames[index], (err) => {
                if (err) {
                    parentPort.postMessage(`Erro ao exportar a tabela ${tableNames[index]}: ${err.message}`);
                }
                exportAllTables(index + 1);
            });
        } else {
            parentPort.postMessage('Todas as tabelas foram exportadas.');
        }
    };

    exportAllTables(0);
}
