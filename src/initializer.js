var $ = require('jquery');
var _ = require('lodash');
var ZenzaWatch = {
  util:{},
  debug: {},
  api: {}
};
var PlayerSession = {};
var Config = {};
var NicoComment = {};
var localStorageEmitter = {};
var PopupMessage = {};
var VideoInfoLoader = {};

var MessageApiLoader = function() {};
var NicoVideoPlayer = function() {};
var NicoVideoPlayerDialog = function() {};

//===BEGIN===
    var initialize = function() {
      console.log('%cinitialize ZenzaWatch...', 'background: lightgreen; ');
      initialize = _.noop;
      ZenzaWatch.util.addStyle(__css__);

      if (!ZenzaWatch.util.isPremium() && !Config.getValue('forceEnable')) {
        return;
      }

      window.console.time('createOffscreenLayer');
      NicoComment.offScreenLayer.get().then(function(offScreenLayer) {
        window.console.timeEnd('createOffscreenLayer');
        // コメントの位置計算用のレイヤーが必要
        // スマートじゃないので改善したい

        var dialog;

        // watchページか？
        if (location.href.match('\/www.nicovideo.jp\/watch\/')) {
          if (ZenzaWatch.util.isLogin()) {
            dialog = initializeDialogPlayer(Config, offScreenLayer);
            if (!ZenzaWatch.util.hasFlashPlayer()) {
              initializeGinzaSlayer(dialog);
            }
          } else {
          // 非ログイン画面用プレイヤーをセットアップ
            initializeNoLoginWatchPagePlayer(Config, offScreenLayer);
            //var dialog = initializeDialogPlayer(Config, offScreenLayer);
            //dialog.open(getWatchId())
          }
        } else {
          dialog = initializeDialogPlayer(Config, offScreenLayer);
        }

        ZenzaWatch.debug.dialog = dialog;

        localStorageEmitter.on('message', function(packet) {
          if (packet.type !== 'openVideo') { return; }
          if (dialog.getId() !== Config.getValue('lastPlayerId', true)) { return; }
          Config.setSessionValue('autoCloseFullScreen', false);
          dialog.open(packet.watchId);
        });

        if (location.href.match('\/www.nicovideo.jp\/watch\/')) {
          return;
        }

        window.addEventListener('beforeunload', function() {
          PlayerSession.save(dialog.getPlayingStatus());
          dialog.close();
        });

        var lastSession = PlayerSession.restore();
        var screenMode = Config.getValue('screenMode');
        if (
          lastSession.playing &&
          (screenMode === 'small'    ||
           screenMode === 'sideView' ||
           location.href === lastSession.url ||
           Config.getValue('continueNextPage')
           )
        ) {
          dialog.open(lastSession.watchId, lastSession);
        }
      });

      $('body').trigger('ZenzaWatchReady', ZenzaWatch);
    };

    // 非ログイン状態のwatchページ用のプレイヤー生成
    var initializeNoLoginWatchPagePlayer = function(conf, offScreenLayer) {
      ZenzaWatch.util.addStyle(__no_login_watch_css__);
      var nicoVideoPlayer = new NicoVideoPlayer({
        offScreenLayer: offScreenLayer,
        node: '.logout-video-thumb-box',
        volume:       conf.getValue('volume'),
        loop:         conf.getValue('loop'),
        playerConfig: conf
      });

      VideoInfoLoader.on('load', function(videoInfo, type) {
        window.console.timeEnd('VideoInfoLoader');
        console.log('VideoInfoLoader.load!', videoInfo, type);

        nicoVideoPlayer.setThumbnail(videoInfo.thumbImage);
        nicoVideoPlayer.setVideo(videoInfo.url);

        window.console.time('loadComment');
        var messageApiLoader = new MessageApiLoader();
        messageApiLoader.load(videoInfo.ms, videoInfo.thread_id, videoInfo.l).then(
          function(result) {
            window.console.timeEnd('loadComment');
            nicoVideoPlayer.setComment(result.xml);
          },
          function() {
            PopupMessage.alert('コメントの取得失敗 ' + videoInfo.ms);
          }
        );
      });

      window.console.time('VideoInfoLoader');
      VideoInfoLoader.load(getWatchId());
    };

    var initializeDialogPlayer = function(conf, offScreenLayer) {
      var dialog = initializeDialog(conf, offScreenLayer);
      initializeHoverMenu(dialog);

      return dialog;
    };

    var initializeGinzaSlayer = function(dialog) {
      $('.notify_update_flash_player').remove();

      dialog.open(getWatchId());
    };


    var initializeHoverMenu = function(dialog) {
      var $menu = $([
      '<div class="zenzaWatchHoverMenu">',
        '<span>Zen</span>',
      '</div>'].join(''));

      var hoverElement = null;

      var onHover = function(e) {
        hoverElement = e.target;
      };

      var onMouseout = function(e) {
        if (e.target === hoverElement) {
          hoverElement = null;
        }
      };

      var onHoverEnd = function(e) {
        if (e.target !== hoverElement) { return; }
        var $target = $(e.target).closest('a');
        var href = $target.attr('data-href') || $target.attr('href');
        var watchId = ZenzaWatch.util.getWatchId(href);
        var offset = $target.offset();
//        var bottom = offset.top  + $target.outerHeight();
//        var right  = offset.left + $target.outerWidth();

        if ($target.hasClass('noHoverMenu')) { return; }
        if (!watchId.match(/^[a-z0-9]+$/)) { return; }
        if (href.indexOf('live.nicovideo.jp') >= 0) { return; }
        $('.zenzaWatching').removeClass('zenzaWatching');
        $target.addClass('.zenzaWatching');
        $menu
          .attr({
            'data-watch-id': watchId
          })
          .css({
            top:  offset.top, //  - $menu.outerHeight(),
            left: offset.left - $menu.outerWidth()  / 2
          })
          .addClass('show');
      };

      var onMenuClick = function(e) {
        var $target = $(e.target);
        var watchId = $target.closest('.zenzaWatchHoverMenu').attr('data-watch-id');
        console.log('open: ', watchId);

        if (e.shiftKey) {
          // 秘密機能。最後にZenzaWatchを開いたウィンドウで開く
          localStorageEmitter.send({
            type: 'openVideo',
            watchId: watchId
          });
        } else {

          Config.refreshValue('autoCloseFullScreen');
          dialog.open(watchId);

        }
      };

      $menu.on('click', onMenuClick);

      ZenzaWatch.emitter.on('hideHover', function() {
        $menu.removeClass('show');
      });

      $('body')
        .on('mouseover', 'a[href*="watch/"]', onHover)
        .on('mouseover', 'a[href*="watch/"]', _.debounce(onHoverEnd, 500))
        .on('mouseout',  'a[href*="watch/"]', onMouseout)
        .on('click', function() { $menu.removeClass('show'); })
        .append($menu);
    };

    var initializeDialog = function(conf, offScreenLayer) {
      console.log('initializeDialog');
      var dialog = new NicoVideoPlayerDialog({
        offScreenLayer: offScreenLayer,
        playerConfig: conf
      });

      return dialog;
    };


    if (window.name !== 'commentLayerFrame') {
      initialize();
    }