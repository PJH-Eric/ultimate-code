/* ===== modes/online-ui.js — 線上模式（M4 實作；目前為佔位）===== */
(function (root) {
  'use strict';
  root.OnlineUI = {
    init: function () {},
    inRoom: function () { return false; },
    enterLobby: function () { root.Kit.toast(root.I18N.t('online.soon'), 'warn'); },
    exitLobby: function () { root.App.show('home'); },
    confirmLeave: function () { root.App.show('home'); },
    renderLobby: function () {}, renderRoom: function () {}, sideOpened: function () {},
    pendingResume: function () { return false; }, resume: function () {}
  };
})(typeof self !== 'undefined' ? self : this);
