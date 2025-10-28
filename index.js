// =================================================================
// ⚠️ ATENÇÃO: COLE O CÓDIGO INTEIRO AQUI ⚠️
// (O mesmo código da nossa mensagem anterior, com os logs detalhados)
// =================================================================
const express = require('express');
const bodyParser = require('body-parser');
const mercadopago = require('mercadopago');
const mqtt = require('mqtt');

const app = express();
// O Render define a porta pela variável de ambiente PORT
const PORT = process.env.PORT || 3000;

// =================================================================
// ⚠️ ATENÇÃO: PREENCHA SUAS CREDENCIAIS CORRETAMENTE ⚠️
// (Verifique se estas estão corretas)
// =================================================================

// --- CREDENCIAIS DO MERCADO PAGO ---
const MP_ACCESS_TOKEN = 'SEU_ACCESS_TOKEN_DE_PRODUCAO_AQUI';

// --- CREDENCIAIS DO MQTT ---
const MQTT_BROKER_URL = 'mqtt://SEU_BROKER_URL'; // Ex: 'mqtt://broker.hivemq.com'
const MQTT_USERNAME = 'SEU_USUARIO_MQTT'; // Deixe "" se não tiver
const MQTT_PASSWORD = 'SUA_SENHA_MQTT';   // Deixe "" se não tiver

// --- TÓPICO MQTT ---
const MQTT_TOPIC_COMANDO = 'maquina_agua/pagamento'; // CONFIRME SE ESTE É O NOME DO TÓPICO

// =================================================================
// FIM DAS CONFIGURAÇÕES
// =================================================================


// --- Configuração do Mercado Pago ---
mercadopago.configure({
    access_token: MP_ACCESS_TOKEN
});

// --- Configuração do Cliente MQTT ---
console.log('🔌 Tentando conectar ao Broker MQTT...');
const mqttClient = mqtt.connect(MQTT_BROKER_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD
});

mqttClient.on('connect', () => {
    console.log('✅ Conectado ao Broker MQTT com sucesso.');
});

mqttClient.on('error', (err) => {
    console.error('❌ Erro na conexão MQTT:', err);
});

// --- Middlewares ---
app.use(bodyParser.json());

// --- Rota de "Saúde" (Health Check) ---
app.get('/', (req, res) => {
    res.send('Servidor da Máquina de Água (v2.0 com logs) está no ar e operante.');
});


// =================================================================
// 🚀 ROTA DE NOTIFICAÇÃO (WEBHOOK) DO MERCADO PAGO 🚀
// =================================================================
app.post('/notificacao-mp', async (req, res) => {
    
    console.log('--- NOTIFICAÇÃO DO MP RECEBIDA ---');
    // Log completo da notificação para depuração:
    console.log('Conteúdo:', JSON.stringify(req.body, null, 2));

    const notificacao = req.body;

    // 1. FILTRAR O TIPO DE NOTIFICAÇÃO
    if (notificacao.topic === 'payment' || notificacao.type === 'payment') {
        
        const paymentId = notificacao.data?.id || notificacao.resource; 

        if (!paymentId) {
            console.warn('⚠️ Notificação de pagamento sem ID. Ignorando.');
            return res.sendStatus(200);
        }

        console.log(`🔎 Notificação de pagamento recebida. ID: ${paymentId}. Buscando detalhes na API do MP...`);

        try {
            // 2. BUSCAR OS DETALHES DO PAGAMENTO
            const payment = await mercadopago.payment.get(paymentId);
            
            if (!payment || !payment.body) {
                console.error(`❌ Falha grave ao buscar dados do pagamento ${paymentId} na API do MP.`);
                return res.sendStatus(500); 
            }

            const paymentDetails = payment.body;
            
            console.log(`ℹ️ DETALHES DO PAGAMENTO: ID: ${paymentId} | STATUS: ${paymentDetails.status} | TIPO: ${paymentDetails.payment_type_id}`);

            // 3. VERIFICAR SE O PAGAMENTO ESTÁ APROVADO ('approved')
            if (paymentDetails.status === 'approved') {
                
                console.log('✅ PAGAMENTO APROVADO! Preparando para enviar comando MQTT...');
                
                // 4. ENVIAR COMANDO PARA O ESP32 VIA MQTT
                const mensagemMQTT = 'LIBERAR_AGUA';
                
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