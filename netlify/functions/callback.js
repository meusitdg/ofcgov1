const { executar, carregarHandler } = require('./shared/adaptar');
const handler = carregarHandler(require('../../api/vizzionpay/callback.js'));

exports.handler = async (event) => executar(event, handler);
