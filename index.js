// Forçando um novo deploy para checar os logs
const express = require('express');
const bodyParser = require('body-parser');
const mercadopago = require('mercadopago');
const mqtt = require('mqtt');

const app = express();
// O Render define a porta pela variável de ambiente PORT
const PORT = process.env.PORT || 3000;

// =================================================================
// ⚠️ ATENÇÃO: PREENCHA O SEU ACCESS TOKEN DO MERCADO PAGO ⚠️
// =================================================================

// --- CREDENCIAIS DO MERCADO PAGO ---
// (Use o Access Token de PRODUÇÃO)
const MP_ACCESS_TOKEN = 'APP_USR-2337638380276117-092714-fcb4c7f0435c786f6c58a959e3dac448-1036328569'; // 👈 ⚠️ PREENCHA AQUI!

// --- CREDENCIAIS DO MQTT ---
// (Atualizado com o NOVO usuário dedicado para o servidor)
const MQTT_BROKER_URL = 'mqtts://d848ae40758c4732b9333f823b832326.s1.eu.hivemq.cloud:8883';
const MQTT_USERNAME = 'servidor_nodejs'; // ✅ Novo usuário
const MQTT_PASSWORD = 'Water2025';        // ✅ Nova senha

// --- TÓPICO MQTT ---
// (O tópico exato que o seu ESP32 está escutando)
const MQTT_TOPIC_COMANDO = 'watervendor/maquina01/comandos';

// =================================================================
// FIM DAS CONFIGURAÇÕES
// =================================================================


// --- Configuração do Mercado Pago (SDK v3) ---
console.log('🔌 Configurando cliente Mercado Pago (SDK v3)...');
const mpClient = new mercadopago.MercadoPagoConfig({
    access_token: MP_ACCESS_TOKEN
});
const mpPayment = new mercadopago.Payment(mpClient);


// --- Configuração do Cliente MQTT ---
console.log('🔌 Tentando conectar ao Broker MQTT...');
const mqttClient = mqtt.connect(MQTT_BROKER_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    clientId: 'servidor_nodejs', // ✅ ID DEVE SER IGUAL AO NOVO USERNAME
    reconnectPeriod: 5000        // Aumenta o tempo de reconexão para 5 segundos
});

// --- LOGS DE EVENTOS MQTT (PARA DEPURAÇÃO) ---

mqttClient.on('connect', () => {
    console.log('✅ Conectado ao Broker MQTT com sucesso.');
});

mqttClient.on('error', (err) => {
    console.error('❌ Erro na conexão MQTT:', err);
});

mqttClient.on('reconnect', () => {
    console.log('🔄 Tentando reconectar ao MQTT...');
});

mqttClient.on('close', () => {
    console.log('🚪 Conexão MQTT fechada (evento "close").');
});

mqttClient.on('offline', () => {
    console.log('🌐 Cliente MQTT ficou offline (evento "offline").');
});

mqttClient.on('end', () => {
    console.log('🔚 Conexão MQTT terminada (evento "end").');
});

// --- FIM DOS LOGS MQTT ---


// --- Middlewares ---
app.use(bodyParser.json());

// --- Rota de "Saúde" (Health Check) ---
app.get('/', (req, res) => {
    console.log('ℹ️ Rota / (Health Check) acessada. Servidor está no ar.');
    res.send('Servidor da Máquina de Água (v4 - HiveMQ fix) está no ar e operante.');
});

// --- NOVO HANDLER GET (PARA DEPURAÇÃO DO 404) ---
app.get('/notificacao-mp', (req, res) => {
    console.warn('⚠️ AVISO: Recebida uma requisição GET na rota /notificacao-mp. Esta rota só aceita POST.');
    // Responde 405 - Method Not Allowed (o erro correto)
    res.status(405).send('Method Not Allowed: Esta rota só aceita POST.');
});
// --- FIM DO NOVO HANDLER ---
// =================================================================
// 🚀 ROTA DE NOTIFICAÇÃO (WEBHOOK) DO MERCADO PAGO 🚀
// =================================================================
app.post('/notificacao-mp', async (req, res) => {
    
    console.log('--- NOTIFICAÇÃO DO MP RECEBIDA ---');
    console.log('Conteúdo:', JSON.stringify(req.body, null, 2));

    const notificacao = req.body;

    // 1. FILTRAR O TIPO DE NOTIFICAÇÃO
    if (notificacao.topic === 'payment' || notificacao.type === 'payment') {
        
        const paymentId = notificacao.data?.id; 

        if (!paymentId) {
            console.warn('⚠️ Notificação de pagamento sem ID (data.id). Ignorando.');
            return res.sendStatus(200);
        }

        console.log(`🔎 Notificação de pagamento recebida. ID: ${paymentId}. Buscando detalhes na API do MP...`);

        try {
            // 2. BUSCAR OS DETALHES DO PAGAMENTO
            // (Usando a nova SDK v3)
            const paymentDetails = await mpPayment.get({ id: paymentId });
            
            if (!paymentDetails) {
                console.error(`❌ Falha grave ao buscar dados do pagamento ${paymentId} na API do MP.`);
                return res.sendStatus(500); 
            }
            
            console.log(`ℹ️ DETALHES DO PAGAMENTO: ID: ${paymentId} | STATUS: ${paymentDetails.status} | TIPO: ${paymentDetails.payment_type_id}`);

            // 3. VERIFICAR SE O PAGAMENTO ESTÁ APROVADO ('approved')
            if (paymentDetails.status === 'approved') {
                
                console.log('✅ PAGAMENTO APROVADO! Preparando para enviar comando MQTT...');
                
                // 4. ENVIAR COMANDO PARA O ESP32 VIA MQTT
                const mensagemMQTT = 'LIBERAR_AGUA'; // Mude se o comando for outro
                
                mqttClient.publish(MQTT_TOPIC_COMANDO, mensagemMQTT, (err) => {
                    if (err) {
                        console.error('❌ Erro ao publicar mensagem no MQTT:', err);
                    } else {
                        console.log(`🚀 Comando "${mensagemMQTT}" publicado com sucesso no tópico "${MQTT_TOPIC_COMANDO}".`);
                    }
                });

            } else if (paymentDetails.status === 'in_process' || paymentDetails.status === 'pending') {
                console.log(`⏳ Pagamento ${paymentId} ainda está "${paymentDetails.status}". Aguardando notificação final.`);
            } else {
                console.log(`❌ Pagamento ${paymentId} foi "${paymentDetails.status}". Nenhuma ação necessária.`);
            }

        } catch (error) {
            console.error(`💥 Erro ao processar o pagamento ${paymentId}:`, error.message);
        }
    
    } else if (notificacao.topic === 'merchant_order') {
        console.log('ℹ️ Recebida notificação de "merchant_order". Ignorando (focando apenas em "payment").');
    } else {
        console.log(`⚠️ Recebido tópico desconhecido: "${notificacao.topic || notificacao.type}". Ignorando.`);
    }

    res.sendStatus(200);
});


// --- Iniciar o Servidor ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor da máquina de água iniciado e rodando na porta ${PORT}`);
});