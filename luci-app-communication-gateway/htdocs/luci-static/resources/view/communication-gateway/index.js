'use strict';
'require view';
'require rpc';
'require uci';
'require poll';
'require ui';

var gatewayStatus = rpc.declare({
	object: 'communication_gateway',
	method: 'status',
	expect: {}
});

var sipCommand = rpc.declare({
	object: 'communication_gateway',
	method: 'sip_command',
	params: [ 'action', 'target' ],
	expect: {}
});

var enableSipControl = rpc.declare({
	object: 'communication_gateway',
	method: 'enable_sip_control',
	expect: {}
});

var modemInfo = rpc.declare({
	object: 'qmodem',
	method: 'info',
	params: [ 'config_section' ],
	expect: {}
});

var getSms = rpc.declare({
	object: 'qmodem',
	method: 'get_sms',
	params: [ 'config_section' ],
	expect: {}
});

var sendSms = rpc.declare({
	object: 'qmodem',
	method: 'send_sms',
	params: [ 'config_section', 'params' ],
	expect: {}
});

function masked(value, key) {
	if (value == null)
		return '';
	if (/imei|imsi|iccid/i.test(key || '') && typeof value === 'string' && value.length > 6)
		return value.slice(0, 3) + '••••••' + value.slice(-3);
	if (Array.isArray(value))
		return value.map(function(v) { return masked(v, key); });
	if (typeof value === 'object') {
		var out = {};
		Object.keys(value).forEach(function(k) { out[k] = masked(value[k], k); });
		return out;
	}
	return value;
}

function pretty(value) {
	return JSON.stringify(masked(value, ''), null, 2) || '—';
}

function notifyError(error) {
	var message = error && (error.message || error.error) ? (error.message || error.error) : String(error);
	ui.addNotification(null, E('p', {}, [ message ]), 'error');
}

return view.extend({
	load: function() {
		return uci.load('qmodem').catch(function() {}).then(function() {
			this.modems = uci.sections('qmodem', 'modem-device') || [];
			this.selectedModem = this.modems.length ? this.modems[0]['.name'] : '';
			return this.fetchAll();
		}.bind(this));
	},

	fetchAll: function() {
		var tasks = [ L.resolveDefault(gatewayStatus(), {}) ];
		if (this.selectedModem)
			tasks.push(L.resolveDefault(modemInfo(this.selectedModem), {}));
		return Promise.all(tasks).then(function(result) {
			return { gateway: result[0] || {}, modem: result[1] || {} };
		});
	},

	setText: function(node, value) {
		if (node)
			node.textContent = value == null || value === '' ? '—' : String(value);
	},

	renderData: function(data) {
		var s = data.gateway || {};
		this.setText(this.wanStatus, s.wan_up ? '已连接' : '未连接');
		this.setText(this.wanIp, s.wan_ip || '未获取');
		this.setText(this.tailscaleStatus, s.tailscale_up ? '已连接' : '未连接');
		this.setText(this.tailscaleIp, s.tailscale_ip || '—');
		this.setText(this.baresipStatus, s.baresip_running ? '运行中' : '未运行');
		this.setText(this.ctrlStatus, s.ctrl_tcp_secure ? '本机安全接口已启用' : (s.ctrl_tcp_module ? '控制模块未安全监听' : '未检测到控制模块'));
		this.setText(this.audioPlayback, s.usb_audio_playback ? '已识别' : '未识别');
		this.setText(this.audioCapture, s.usb_audio_capture ? '已识别' : '未识别');
		this.sipReginfo.textContent = s.sip_reginfo || '暂无注册信息；请先启用本机控制接口。';
		this.sipCalls.textContent = s.sip_calls || '暂无通话信息。';
		this.modemDetails.textContent = this.selectedModem ? pretty(data.modem) : '尚未配置 QModem 模组实例。';
		this.callControls.hidden = !s.ctrl_tcp_secure;
		this.enableControlButton.hidden = !!s.ctrl_tcp_secure;
		this.enableControlButton.disabled = !s.baresip_running || !s.ctrl_tcp_module;
		this.refreshButton.disabled = false;
	},

	refresh: function() {
		this.refreshButton.disabled = true;
		return this.fetchAll().then(function(data) {
			this.renderData(data);
		}.bind(this)).catch(notifyError).finally(function() {
			this.refreshButton.disabled = false;
		}.bind(this));
	},

	runSip: function(action, target) {
		return sipCommand(action, target || '').then(function(result) {
			if (result && result.error)
				throw new Error(result.error);
			this.sipResult.textContent = pretty(result);
			return this.refresh();
		}.bind(this)).catch(notifyError);
	},

	showEnableDialog: function() {
		var self = this;
		ui.showModal('启用 Baresip 网页控制', [
			E('p', {}, [ '将先备份 /etc/baresip/config，再启用 ctrl_tcp，并将监听地址固定为 127.0.0.1:4444。该接口没有自身身份验证，因此绝不监听 LAN/WAN；操作会重启 Baresip，可能中断正在进行的通话。' ]),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn', click: ui.hideModal }, [ '取消' ]),
				E('button', { 'class': 'btn cbi-button-apply', click: function() {
					ui.hideModal();
					enableSipControl().then(function(result) {
						if (result && result.error)
							throw new Error(result.error);
						ui.addNotification(null, E('p', {}, [ result.message || '控制接口已启用' ]), 'info');
						return self.refresh();
					}).catch(notifyError);
				} }, [ '备份并启用' ])
			])
		]);
	},

	render: function() {
		var self = this;
		var root = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ '通信网关管理中心' ]),
			E('p', { 'class': 'cbi-map-descr' }, [ '统一管理 EC20FAG 模组信息、SIP 网络电话、Oracle/Asterisk 注册状态、WAN、Tailscale 与 USB 音频。页面只读取现有网络配置，不修改 WAN 或路由策略。' ])
		]);

		var top = E('div', { 'class': 'cbi-section' });
		this.refreshButton = E('button', { 'class': 'cbi-button cbi-button-action', click: function() { self.refresh(); } }, [ '刷新状态' ]);
		top.appendChild(this.refreshButton);
		this.modemSelect = E('select', { 'class': 'cbi-input-select', change: function(ev) {
			self.selectedModem = ev.target.value;
			self.refresh();
		} });
		if (!this.modems.length)
			this.modemSelect.appendChild(E('option', { value: '' }, [ '未配置 QModem 模组' ]));
		this.modems.forEach(function(m) {
			self.modemSelect.appendChild(E('option', { value: m['.name'] }, [ (m.name || m['.name']) + ' (' + m['.name'] + ')' ]));
		});
		top.appendChild(E('label', {}, [ 'EC20FAG / 模组实例：', this.modemSelect ]));
		root.appendChild(top);

		var status = E('fieldset', { 'class': 'cbi-section' }, [ E('legend', {}, [ '连接与硬件状态' ]) ]);
		var table = E('table', { 'class': 'table' });
		var rows = [
			[ '有线 WAN', 'wanStatus' ], [ 'WAN IPv4', 'wanIp' ],
			[ 'Tailscale', 'tailscaleStatus' ], [ 'Tailscale IPv4', 'tailscaleIp' ],
			[ 'Baresip', 'baresipStatus' ], [ 'SIP 控制接口', 'ctrlStatus' ],
			[ 'USB 音频播放', 'audioPlayback' ], [ 'USB 音频录音', 'audioCapture' ]
		];
		rows.forEach(function(row) {
			var value = E('span', {}, [ '读取中…' ]);
			self[row[1]] = value;
			table.appendChild(E('tr', {}, [ E('td', { 'style': 'width: 34%' }, [ row[0] ]), E('td', {}, [ value ]) ]));
		});
		status.appendChild(table);
		root.appendChild(status);

		var modem = E('fieldset', { 'class': 'cbi-section' }, [
			E('legend', {}, [ 'EC20FAG / SIM / 运营商与网络信息' ]),
			E('p', {}, [ '以下数据由 QModem 读取；不执行 QMI 拨号，不更改当前有线 WAN。IMEI、IMSI、ICCID 在页面中自动遮挡。' ])
		]);
		this.modemDetails = E('pre', { 'style': 'white-space:pre-wrap;overflow:auto;max-height:360px' }, [ '读取中…' ]);
		modem.appendChild(this.modemDetails);
		root.appendChild(modem);

		var sip = E('fieldset', { 'class': 'cbi-section' }, [ E('legend', {}, [ 'SIP 网络电话 / Oracle Asterisk' ]) ]);
		this.enableControlButton = E('button', { 'class': 'cbi-button cbi-button-action', click: function() { self.showEnableDialog(); } }, [ '启用本机安全控制接口' ]);
		sip.appendChild(this.enableControlButton);
		sip.appendChild(E('p', {}, [ '启用后网页可通过路由器本机 Baresip 控制接口拨号、接听、挂断、静音和发送 DTMF。控制端口只绑定 127.0.0.1，不对外网开放。拨号请输入完整 SIP URI。' ]));
		this.callControls = E('div', {});
		this.callControls.hidden = true;
		this.dialInput = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': 'sip:1001@example.com', 'style': 'max-width:360px' });
		this.callControls.appendChild(E('div', { 'class': 'cbi-section' }, [
			this.dialInput,
			E('button', { 'class': 'cbi-button cbi-button-apply', click: function() { self.runSip('dial', self.dialInput.value.trim()); } }, [ '拨号' ]),
			E('button', { 'class': 'cbi-button', click: function() { self.runSip('answer'); } }, [ '接听' ]),
			E('button', { 'class': 'cbi-button cbi-button-remove', click: function() { self.runSip('hangup'); } }, [ '挂断' ]),
			E('button', { 'class': 'cbi-button', click: function() { self.runSip('mute'); } }, [ '静音 / 取消静音' ])
		]));
		var keypad = E('div', { 'class': 'cbi-section' });
		[ '1','2','3','4','5','6','7','8','9','*','0','#' ].forEach(function(digit) {
			keypad.appendChild(E('button', { 'class': 'cbi-button', click: function() { self.runSip('dtmf', digit); } }, [ digit ]));
		});
		this.callControls.appendChild(keypad);
		sip.appendChild(this.callControls);
		sip.appendChild(E('h3', {}, [ 'SIP 注册信息' ]));
		this.sipReginfo = E('pre', { 'style': 'white-space:pre-wrap;overflow:auto' }, [ '读取中…' ]);
		sip.appendChild(this.sipReginfo);
		sip.appendChild(E('h3', {}, [ '当前通话' ]));
		this.sipCalls = E('pre', { 'style': 'white-space:pre-wrap;overflow:auto' }, [ '读取中…' ]);
		sip.appendChild(this.sipCalls);
		this.sipResult = E('pre', { 'style': 'white-space:pre-wrap;overflow:auto' }, [ '' ]);
		sip.appendChild(this.sipResult);
		root.appendChild(sip);

		var sms = E('fieldset', { 'class': 'cbi-section' }, [ E('legend', {}, [ 'SIM 短信' ]) ]);
		this.smsNumber = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': '+1XXXXXXXXXX' });
		this.smsBody = E('textarea', { 'class': 'cbi-input-textarea', 'rows': 3, 'placeholder': '短信内容' });
		this.smsOutput = E('pre', { 'style': 'white-space:pre-wrap;overflow:auto;max-height:300px' }, [ '点击“读取短信”查看 SIM 短信。' ]);
		sms.appendChild(E('div', {}, [
			E('label', {}, [ '收件号码：', this.smsNumber ]),
			E('label', {}, [ '短信内容：', this.smsBody ]),
			E('button', { 'class': 'cbi-button cbi-button-apply', click: function() {
				if (!self.selectedModem) { notifyError(new Error('尚未配置 QModem 模组')); return; }
				sendSms(self.selectedModem, { phone_number: self.smsNumber.value.trim(), message_content: self.smsBody.value }).then(function(result) {
					self.smsOutput.textContent = pretty(result);
				}).catch(notifyError);
			} }, [ '发送短信' ]),
			E('button', { 'class': 'cbi-button', click: function() {
				if (!self.selectedModem) { notifyError(new Error('尚未配置 QModem 模组')); return; }
				getSms(self.selectedModem).then(function(result) { self.smsOutput.textContent = pretty(result); }).catch(notifyError);
			} }, [ '读取短信' ])
		]));
		sms.appendChild(this.smsOutput);
		root.appendChild(sms);

		var audio = E('fieldset', { 'class': 'cbi-section' }, [
			E('legend', {}, [ '音频链路说明' ]),
			E('p', {}, [ 'Baresip 通过 ALSA 使用路由器端 USB Audio。此页面检查播放/录音设备是否被系统识别；实际双向通话仍取决于 EC20FAG 音频接口、USB Audio 设备路由及 Baresip 当前音频配置。' ])
		]);
		root.appendChild(audio);

		this.root = root;
		this.renderData({ gateway: this.initialData && this.initialData.gateway || {}, modem: this.initialData && this.initialData.modem || {} });
		this.pollFn = function() { self.refresh(); };
		poll.add(this.pollFn, 10);
		return root;
	},

	remove: function() {
		if (this.pollFn)
			poll.remove(this.pollFn);
	}
});
