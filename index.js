require('dotenv').config();
const express = require('express');
const mercadopago = require('mercadopago');
const mqtt = require('mqtt');
const axios = require('axios'); // Para ler a planilha do Google

const app = express();
const PORT = process.env.PORT || 10000;

// --- CONFIGURAÇÃO ---
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL;
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_TOPIC_COMANDO = process.env.MQTT_TOPIC_COMANDO;
const SHEETS_URL = process.env.SHEETS_URL; // A URL do CSV da sua planilha
const SERVER_URL = 'https://watervendor-server.onrender.com';

if (!MP_ACCESS_TOKEN || !SHEETS_URL) {
    console.error('❌ ERRO FATAL: MP_ACCESS_TOKEN ou SHEETS_URL faltando no Render!');
    // Não damos exit(1) para não derrubar o servidor, mas ele não vai vender.
}

// ... (Configuração do MP e MQTT iguais ao anterior) ...
const mpClient = new mercadopago.MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
const mpPreference = new mercadopago.Preference(mpClient);
const mpPayment = new mercadopago.Payment(mpClient);

const mqttClient = mqtt.connect(MQTT_BROKER_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    connectTimeout: 5000
});
mqttClient.on('connect', () => console.log('✅ Conectado ao MQTT.'));
mqttClient.on('error', (err) => console.error('❌ Erro MQTT:', err.message));

app.use(express.json());
app.get('/', (req, res) => res.send('Servidor WaterVendor (Sheets Edition) Online 🚀'));

// --- FUNÇÃO PARA BUSCAR PREÇO NA PLANILHA ---
async function buscarPrecoNaPlanilha(volumeDesejado) {
    try {
        const response = await axios.get(SHEETS_URL);
        const csvData = response.data;
        
        // Quebra o CSV em linhas
        const linhas = csvData.split('\n');
        
        // Percorre cada linha procurando o volume
        for (let i = 0; i < linhas.length; i++) {
            const colunas = linhas[i].trim().split(',');
            // Supondo Coluna A = Volume, Coluna B = Preço
            if (colunas.length >= 2) {
                const volumeNaPlanilha = colunas[0].trim();
                const precoNaPlanilha = colunas[1].trim();
                
                // Se o volume da linha for igual ao que o cliente quer
                if (volumeNaPlanilha == volumeDesejado) {
                    return parseFloat(precoNaPlanilha);
                }
            }
        }
        return null; // Não achou
    } catch (error) {
        console.error('Erro ao ler planilha:', error.message);
        return null;
    }
}

// --- ROTA DE COMPRA INTELIGENTE (COM PLANILHA) ---
app.get('/comprar/:maquinaid/:volume', async (req, res) => {
    const { maquinaid, volume } = req.params;
    
    // 1. Busca o preço atualizado na planilha do Google
    const precoAtual = await buscarPrecoNaPlanilha(volume);

    if (!precoAtual) {
        return res.status(404).send(`Erro: Produto de ${volume}ml não encontrado na tabela de preços.`);
    }

    console.log(`🛒 Pedido: ${volume}ml -> R$ ${precoAtual} (Lido da Planilha)`);

    try {
        // 2. Cria a preferência no MP com esse preço
        const preferenceData = {
            items: [
                {
                    id: `agua-${volume}`,
                    title: `Água Mineral ${parseInt(volume)/1000}L`,
                    quantity: 1,
                    currency_id: 'BRL',
                    unit_price: precoAtual
                }
            ],
            external_reference: `${maquinaid}-${volume}`,
            notification_url: `${SERVER_URL}/notificacao-mp`,
            auto_return: 'approved',
            back_urls: { success: 'https://google.com', failure: 'https://google.com', pending: 'https://google.com' }
        };

        const preference = await mpPreference.create({ body: preferenceData });
        res.redirect(preference.init_point);

    } catch (error) {
        console.error('💥 Erro ao criar preferência:', error);
        res.status(500).send('Erro no pagamento.');
    }
});

// ... (Rota de Webhook /notificacao-mp IGUAL À ANTERIOR) ...
// (Vou copiar aqui para ficar completo)
app.post('/notificacao-mp', async (req, res) => {
    const { type, data, action } = req.body;
    if (type === 'payment' || action === 'payment.updated') {
        const paymentId = data?.id;
        if (!paymentId) return res.sendStatus(200);
        // console.log(`🔔 Webhook recebido: ${paymentId}`); // Opcional: menos log
        try {
            const payment = await mpPayment.get({ id: paymentId });
            if (payment.status === 'approved') {
                const referencia = payment.external_reference;
                console.log(`✅ Pagamento ${paymentId} APROVADO! Ref: ${referencia}`);
                if (referencia && mqttClient.connected) {
                    const partes = referencia.split('-');
                    const vol = partes.length >= 2 ? parseInt(partes[1]) : 1000;
                    mqttClient.publish(MQTT_TOPIC_COMANDO, JSON.stringify({ msg: vol }), { qos: 1 });
                }
            }
        } catch (error) { console.error('⚠️ Erro Webhook:', error.message); }
    }
    res.sendStatus(200);
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));