var View = require("./View.js") ;
var Nut = require("../../../../lib/mvc/Nut.js") ;
var Steps = require("ocsteps") ;
var utilstr = require("../../../../lib/util/string.js") ;

(function(jQuery){

    function Director($document)
    {
        this.$document = $document || jQuery(document) ;
        this._request = null ;
        this.enable = true ;
    }

    Director.prototype.setup = function($)
    {
        var director = this ;

        // 当前网页中的元素事件
        function onRequestElement(event)
        {
            if( !director.enable || jQuery(event.target).attr("target") )
            {
                return ;
            }

            if(event)
            {
                // 事件已经停止
                if(event.returnValue===false)
                {
                    return ;
                }

                event.returnValue = false ;
            }

            jQuery(this).request() ;

            // 取消浏览器默认行为
            return false ;
        }

        // for link(a tag)
        this.$document.on("click","a.stay,a.stay-view,a.stay-top,a.stay-lazy,a.stay-action",onRequestElement) ;

        // for form
        this.$document.on("submit","form.stay,form.stay-view,form.stay-top,form.stay-lazy,form.stay-action",onRequestElement) ;

        // state 事件
        window.onpopstate = function(e) {

            if(e.state && e.state.ocstate) {
                if(e.state.data && e.state.data.constructor!==Array) 
                {
                    var data = [] ;
                    for(var name in e.state.data)
                        data.push({name:name,value:e.state.data[name]}) ;
                    e.state.data = data ;
                }

		// 前进/后退时需要$layout=true,以便 compareLayoutStruct() 能够正确计算 target
		// 这是一个不完善的解决方案，完善的方案应该在history里记录 target
		if(e.state.data){
		    for(var i=e.state.data.length-1;i>=0;i--){
			if( e.state.data[i].name=='$layout' && (e.state.data[i].value=='false'||e.state.data[i].value=='0') )
			    e.state.data.splice(i,1) ;
		    }
		}

                director.request(
                    {
                        url: e.state.url
                        , data: e.state.data || []
                    }
                    , {
                        target: 'lazy'
                        , history: false
                    }
                ) ;
            }
        } ;

        // 处理首次请求
        if( window.history.replaceState )
        {
            window.history.replaceState({
                url: location.pathname
                , data: queryStrings(location.search)
                , ocstate: true
            },null) ;
        }
    }

    /**
     * 根据传入的 "then" 参数，构建 ajax 对象
     */
    Director.buildParamThen = function(then,element)
    {
        if(then===undefined)
        {
            // 从elemt
            if(element)
            {
                $element = $(element) ;
                var staytarget = $element.attr("stay-target") ;
                if( staytarget )
                {
                    then = staytarget ;
                }
                else
                {
                    if( $element.hasClass('stay-top') )
                    {
                        then = 'top' ;
                    }
                    else if( $element.hasClass('stay-view') )
                    {
                        then = 'view' ;
                    }
                    else if( $element.hasClass('stay-action') )
                    {
                        then = 'action' ;
                    }
                    else
                    {
                        then = 'lazy' ;
                    }
                }
            }
            else
            {
                then = 'lazy' ;
            }
        }

        var type = typeof then ;
        if( type=='string' )
        {
            then = {
                target: then || 'lazy'
            }
        }
        else if( type=='function' )
        {
            then = {
                callback: then
            }
        }

        // 一个document中的有效元素
        else if( then && then.ownerDocument )
        {
            then = {
                target: then
            }
        }
        else if( type!='object' )
        {
            console.log("you give me a inavlid param 'then'") ;
            return {} ;
        }

        if( typeof then.target=='string' )
        {
            switch(then.target)
            {
            case 'view' :
                if(element)
                {
                    then.target = jQuery(element).parents(".ocview")[0] || null ;
                }
                else
                {
                    then.target = null ;
                }
                break ;

            case 'top' :
                then.target = jQuery(document.body).find(".oclayout-container:last > .ocview:eq(0)") || null ;
                //then.target = jQuery(jQuery(ele).parents(".oclayout")[0]).find(".ocview")[0] || null ;
                break ;

            case 'action' :
                then = {
                    callback: function(err,nut)
                    {
                        if(err)
                        {
                            console.log(err) ;
                        }
                        nut.msgqueue && nut.msgqueue.popup() ;
                    }
                }
                break ;
                
            case 'lazy' :
            case 'default' :
                then.target = null ;
                break ;

                // selector
            default:
                then.target = jQuery(then.target)[0] || null ;
                break ;
            }
        }

        return then ;
    }

    function searchData(data,name)
    {
        for(var i=0;i<data.length;i++)
        {
            if( data[i].name==name )
            {
                return i ;
            }
        }
        return false ;
    }
    function dataValue(data,name)
    {
        var idx = searchData(data,name) ;
        if( idx===false )
        {
            return undefined ;
        }
        else
        {
            return data[idx].value ;
        }
    }

    function dataObjectToArray(data)
    {
        if(_.isArray(data))
        {
            return data ;
        }
        else if(data)
        {
            var newdata = [] ;
            for(var name in data)
            {
                newdata.push({name:name,value:data[name]}) ;
            }
            return newdata ;
        }
    }


    /**
     * 向服务器发送请求，并从服务器取回 nut 对象
     */
    Director.prototype.request = function(ajaxOptions,thenOptions)
    {
        if(!ajaxOptions)
        {
            throw new Error("missing param ajaxOptions") ;
        }
        if(typeof ajaxOptions=='string')
        {
            ajaxOptions = {
                url: ajaxOptions
            }
        }
        if(!ajaxOptions.url || ajaxOptions.url[0]=='#')
        {
            console.log("ignore a empty url request") ;
            return ;
        }
        // 将 controllerpath 形式，转换为"/"开头的url绝对路径
        if( ! /^(https?:\/\/|\/)/.test(ajaxOptions.url) )
        {
            ajaxOptions.url = '/' + ajaxOptions.url ;
        }

        var director = this ;

        // 构建 then 参数
        thenOptions = Director.buildParamThen(thenOptions) ;

        var ajax = ajaxOptions || {} ;
        ajax.dataType = 'json' ;
        ajax.beforeSend = function(req)
        {
            // 一次只请求一个视图
            if(director._request)
            {
                director._request.abort() ;
            }

            // 显示 loading
            director.showViewLoading() ;

            // this time
            director._request = req ;
        } ;

        // ajax data
        ajax.data = ajax.data || [] ;

        if(ajax.data.constructor!==Array)
        {
            console.log("ajax.data: ",ajax.data) ;
            throw new Error("Director.request()的参数 ajaxOptions.data 必须是 Array") ;
        }

        // 根据 thenOptions.target 为 lazy 模式，且 ajaxOptions中未指定 $layout
        if( thenOptions.target!==null && searchData(ajax.data,"$layout")===false )
        {
            ajax.data.push({name:"$layout",value:"false"}) ;
        }

        // 如果需要执行 layout, 则提供 sumsign
        if( dataValue(ajax.data,"$layout")!='false' && searchData(ajax.data,"$sumsign")===false )
        {
            var sumsigns = [] ;
            jQuery(".oclayout[sumsign]").each(function(){
                sumsigns.push( jQuery(this).attr("sumsign") ) ;
            }) ;
            if(sumsigns.length)
            {
                ajax.data.push({name:"$sumsigns",value:sumsigns.join(',')})
            }
        }

        if(searchData(ajax.data,"$render")===false)
        {
            ajax.data.push({name:"$render",value:"false"}) ;
        }

        var callback = ajax.success ;
        ajax.success = function(nut)
        {
            callback && callback.apply(this,arguments) ;

            Nut.restore(nut,function(err,nut){

                if(err)
                {
                    thenOptions.callback && thenOptions.callback(err) ;
                    console.log(err) ;
                    console.log(err.stack) ;
                    return ;
                }

                director.then(nut,thenOptions,ajax) ;
            }) ;
        }

        var cusComplete = ajax.complete ;
        ajax.complete = function()
        {
            // 关闭 loading
            director.hideViewLoading() ;

            cusComplete && cusComplete.apply(this,arguments) ;
        }

        ajax.error = function(err)
        {
            callback && callback.apply(this,arguments) ;
        }


        if( ajax.data.constructor===Array )
        {
            for(var name in ajax.data)
            {
                // exclude length property of Array
                if( ! /^[0-9]+$/.test(name) && name!="length")
                {
                    ajax.data.push( {name:name,value:ajax.data[name]} ) ;
                    ajax.data[name] = undefined ;
                    delete ajax.data[name] ;
                }
            }
        }
        else
        {
            var data = [] ;

            for(var name in ajax.data)
            {
                data.push( {name:name,value:ajax.data[name]} ) ;
            }

            ajax.data = data ;
        }
        // console.log(ajax.data) ;

        // 发送请求
        return jQuery.ajax(ajax) ;
    }


    /**
     * 在 Director.request() 从服务器取得 nut 后，
     * 接着处理后续事务
     */
    Director.prototype.then = function(nut,thenOpt,ajaxReq)
    {
        if(thenOpt.target===null)
        {
            thenOpt.target = this.compareLayoutStruct(nut) ;
        }

        // 根据 thenOpt.target 决定是否需要向 history 增加记录
        // thenOpt.target 在某个 layout 内， 则 thenOpt.target 为主视图 或 layout
        // （todo:这个部分应该专门设计一个对象来负责）
        if( thenOpt.history!==false && thenOpt.target && jQuery(thenOpt.target).parent().hasClass('oclayout-container') /*&& (!ajaxReq.type || ajaxReq.type.toLowerCase()=='get')*/ )
        {
            // console.log(ajaxReq) ;
            var info = utilstr.parseUrl(ajaxReq.url) ;
            var search = [] ;
            for(var name in info.params)
            {
                if(name[0]!='$')
                {
                    search.push( name+'='+info.params[name] ) ;
                }
            }
            if(ajaxReq.data && (!ajaxReq.type || ajaxReq.type.toLowerCase()=='get') )
            {
                for(var i=0;i<ajaxReq.data.length;i++)
                {
                    var name = ajaxReq.data[i].name ;
                    if(name[0]!='$')
                    {
                        search.push( name+'='+ajaxReq.data[i].value ) ;
                    }
                }
            }
            var url = info.protocol + '://' + info.host + (info.port? (':'+info.port):'') + info.path ;
            if( search.length )
            {
                url+= '?' + search.join('&') ;
            }
            // console.log("history",ajaxReq.url,ajaxReq.data,'=>',url) ;

            if(ajaxReq.data.constructor!==Array)
            {
                console.log(ajaxReq.data) ;
                throw new Error("hengheng") ;
            }

            window.history.pushState && window.history.pushState(
                {
                    url: url
                    , data: ajaxReq.data
                    , type: ajaxReq.type
                    , ocstate: true
                }
                , null
                , url
            ) ;
        }


        // 剥开果壳 :)
        nut.crack(function(err,html){
            if(err)
            {
                console.log(err.message) ;
                console.log(err.stack) ;

                thenOpt.callback && thenOpt.callback(err,nut) ;
                return ;
            }

            // 导入视图中引用的 css
            var assets = nut.view.assets ;
            for(var i=0;i<assets.css.length;i++)
                jQuery(document.head).append('<link type="text/css" href="'+assets.css[i]+'" rel="stylesheet">') ;
            for(var i=0;i<assets.script.length;i++)
            {
                if( !$("script[src='"+assets.script[i]+"']").size() )
                    jQuery(document.head).append('<script type="text/javascript" src="'+assets.script[i]+'"></script>') ;
            }

            // 创建视图
            var $rootview = jQuery(html,document.ownerDocument) ;
            var steps = Steps(
                function buildViews(){
                    $rootview.find('.ocview').andSelf().each(function(){
                        this.nut = nut ;
                        this.ajaxOpt = ajaxReq ;
                        View.buildView(this,jQuery.shipper,steps.holdButThrowError()) ;
                    }) ;
                }
                , function placeInViews(){
                    // 切换视图
                    if( thenOpt.target )
                    {
                        $.switcher.replacein(undefined,$rootview[0],thenOpt.target,this.holdButThrowError()) ;
                    }
                }
            ).done(function done(err){
                if(err)
                {
                    console.log(err) ;
                    console.log(err.stack) ;
                }
                thenOpt.callback && thenOpt.callback(err,nut,$rootview) ;
            }) () ;

        }) ;
    }

    /**
     * 比较 nut 中的layout结构 和 当前浏览器中的layout结构，
     * 确定哪些 layout 不需要被更新，
     * 一旦确定，无需更新的layout信息会从 nut 中移除，
     * 返回需要更新的最外层视图
     */
    Director.prototype.compareLayoutStruct = function(nut)
    {

        var target = (function findAvailLayout( nut )
                      {
                          if( nut._children && nut._children.layout )
                          {
                              var $layout = jQuery("[sumsign="+nut._children.layout.model['$sumsign']+"]") ;
                              // bingo !
                              if( $layout.length )
                              {
                                  delete nut._children.layout ;

                                  // just here !
                                  return $layout.find(".oclayout-container>.ocview")[0] ;
                              }
                              else
                              {
                                  return findAvailLayout(nut._children.layout) ;
                              }
                          }

                          return null ;
                      }) (nut) ;

        // 返回找到的，或最上层的 ocview
        return target || jQuery(".ocview")[0] ;
    }

    Director.prototype.showViewLoading = function()
    {
        this.viewLoadingWidget().fadeIn(300) ;
        return this ;
    }

    Director.prototype.hideViewLoading = function()
    {
        this.viewLoadingWidget().fadeOut(400) ;
        return this ;
    }

    Director.prototype.viewLoadingWidget = function()
    {
        var $widget = jQuery(".ocview-loading") ;
        return $widget.length? $widget: this.createViewLoading() ;
    }

    Director.prototype.createViewLoading = function()
    {
        var $widget = jQuery('<div class="ocview-loading" style="position: fixed; z-index: 1000;"><img src="/opencomb/public/style/images/github-loading.gif" ></div>')
                .appendTo(document.body) ;

        function loadingPlace()
        {
            // console.log(document.body.clientHeight,$widget.outerHeight(),document.body.clientHeight/2 - $widget.outerHeight()/2) ;
            $widget.css({
                left: (document.body.clientWidth/2 - $widget.outerWidth()/2 ) + 'px'
                , top: (document.body.clientHeight/2 - $widget.outerHeight()/2 ) + 'px'
            }) ;
        }
        loadingPlace() ;

        jQuery(window).resize(loadingPlace) ;

        return $widget ;
    }

    var queryStrings=function(query) {
        var params=query,reg=/(?:^\?|&)(.*?)=(.*?)(?=&|$)/g,temp,args=[];
        while((temp=reg.exec(params))!=null) args.push([temp[1],decodeURIComponent(temp[2])]);
        return args;
    };



    // -----------------------------------------------------------------
    // jQuery plugin functions
    //
    jQuery.director = new Director() ;

    /**
     * jQuery.director.request() 的别名
     */
    jQuery.request = function()
    {
        return this.director.request.apply(this.director,arguments) ;
    }

    jQuery.controller = function(url,data,thenOpts)
    {
        var ajaxOpts = typeof url=='string'? {url:url}: (url||{}) ;
        ajaxOpts.data = dataObjectToArray(data) ;

        jQuery.request(ajaxOpts,thenOpts) ;
    }

    function buildActionThenOpts(thenOpts){

        // default: popup 消息队列
        if(!thenOpts)
        {
            return {
                callback: function(err,nut)
                {
                    if(err)
                    {
                        console.log(err) ;
                    }
                    nut.msgqueue && nut.msgqueue.popup() ;
                }
            }
        }

        // 显示消息队列的 selector
        else if( typeof thenOpts=='string' )
        {
            var selector = thenOpts ;
            return {
                callback: function(err,nut)
                {
                    if(err)
                    {
                        console.log(err) ;
                    }
                    nut.msgqueue && nut.msgqueue.renderAndAppendTo(selector) ;
                }
            }
        }

        // others
        else
            return  thenOpts ;
    }

    jQuery.action = function(url,data,thenOpts)
    {

        var ajaxOpts = typeof url=='string'? {url:url}: (url||{}) ;
        ajaxOpts.data = dataObjectToArray(data) ;

        jQuery.request(ajaxOpts,buildActionThenOpts(thenOpts)) ;
    }

    /**
     * 这是一个 jQuery 函数
     * use: jQuery('selector').request() ;
     */
    jQuery.fn.request = function(ajaxOptions,thenOptions,asForm)
    {
        if( !this.length )
        {
            return ;
        }
        if( this.constructor!==jQuery )
        {
            throw new Error("$.fn.request() only called on a jQuery array") ;
            return ;
        }
        
        ajaxOptions = ajaxOptions || {} ;
        thenOptions = Director.buildParamThen(
            thenOptions
            , this[0]
        ) ;

        var tagName = this[0].tagName.toUpperCase() ;
        
        

        // 链接
        if( tagName == 'A' )
        {
            ajaxOptions.url = this.attr("href") || ajaxOptions.url ;
        }

        // 表单
        else if( tagName == 'FORM' || asForm || this.hasClass('form') )
        {
            ajaxOptions.url = this.attr("action") || ajaxOptions.url ;
            ajaxOptions.type = this.attr("method") || ajaxOptions.type || 'GET' ;
            ajaxOptions.contentType = this.attr("enctype") || ajaxOptions.contentType || "application/x-www-form-urlencoded" ;

            // jQuery.serializeArray() 仅对 form 有效
            if( tagName=='FORM' )
            {
                var data = jQuery(this[0]).serializeArray() ;
            }
            else
            {
                var data = this.serializeArrayNotform() ;
            }

            if( ajaxOptions.data && !_.isArray(ajaxOptions.data) )
            {
                for(var name in ajaxOptions.data)
                {
                    data.push({name:name,value:ajaxOptions.data[name]}) ;
                }
            }
            ajaxOptions.data = data ;

            //                  this.find('input[name],select[name],textarea[name],checkbox[name][checked]').each(function(){
            //                          ajaxOptions.data[ jQuery(this).attr('name') ] = jQuery(this).val() ;
            //                  }) ;
        }

        else
        {
            throw new Error("$.fn.request() only call as a method of A or FORM element") ;
            return ;
        }

        jQuery.director.request( ajaxOptions, thenOptions ) ;
    }

    jQuery.fn.action = function(thenOpts){
        return this.request(null,buildActionThenOpts(thenOpts)) ;
    }

    jQuery.fn.serializeArrayNotform = function()
    {
        var data = [] ;
        this.find("input[name],select[name],textarea[name]").each(function(){
            var iptname = $(this).attr("name") ;
            switch(this.tagName)
            {
            case 'INPUT' :
                switch( ($(this).attr("type")||"text").toLowerCase() )
                {
                case 'checkbox':
                case 'radio':
                    if( $(this).attr('checked') )
                    {
                        data.push( {name:iptname,value:$(this).val()} ) ;
                    }
                    break ;
                default :
                    data.push( {name:iptname,value:$(this).val()} ) ;
                    break ;
                }
                break ;

            case 'SELECT' :

                for(var i=0;i<this.options; i++)
                {
                    var option = this.options[i] ;
                    if( option.attr("selected") )
                    {
                        data.push( {name:iptname,value:$(option).val()} ) ;
                    }
                }
                break ;

            case 'TEXTAREA' :
                data.push( {name:iptname,value:$(this).val()} ) ;
                break ;
            }
        }) ;

        return data ;
    }

}) (jQuery) ;
