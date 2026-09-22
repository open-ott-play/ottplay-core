package play.ott.core

import kotlin.test.*

class StalkerTest {
    private fun t(value:String)=ProviderValue.text(value)
    private fun n(value:Int)=ProviderValue(ProviderValueKind.NUMBER,value.toString())
    private fun obj(vararg fields:Pair<String,ProviderValue>)=ProviderValue.obj(linkedMapOf(*fields))
    private fun row(vararg fields:Pair<String,String>)=obj(*fields.map {it.first to t(it.second)}.toTypedArray())
    private fun array(vararg values:ProviderValue)=ProviderValue.array(values.toList())
    private fun page(vararg values:ProviderValue)=obj("data" to array(*values))
    private fun reply(value:ProviderValue)=obj("js" to value)
    private fun failure(code:String, block:()->Unit)=assertEquals(code,assertFailsWith<StalkerFailure>(block=block).code)
    private val mac="00:1a:79:01:02:03"

    @Test fun configurationRetainsUrlShapesAndErrorOrder() {
        assertTrue(StalkerProtocol.validMac(mac));assertFalse(StalkerProtocol.validMac(" $mac"));assertFalse(StalkerProtocol.validMac("00:1g:79:01:02:03"))
        assertEquals(StalkerLocation("https://p.test/server/load.php","https://p.test/c/"),StalkerProtocol.browserConfiguration("https://p.test/C/index.html/?x=1",mac,ProviderValue.missing))
        assertEquals("https://p.test/portal.php",StalkerProtocol.browserLocation("https://p.test/portal.php#x").endpoint)
        failure("SOURCE_MAC"){StalkerProtocol.browserConfiguration("bad","bad",row("stb_type" to "bad model"))}
        failure("PORTAL_URL"){StalkerProtocol.browserConfiguration("https://p.test/api/",mac,row("stb_type" to "bad model"))}
        failure("PORTAL_PROFILE"){StalkerProtocol.browserConfiguration("https://p.test/c/",mac,row("stb_type" to "bad model"))}
    }
    @Test fun nativeAndRpcPathsRemainExplicit() {
        assertEquals(listOf("folder","server","load.php"),StalkerProtocol.nativeEndpoint(listOf("folder","C","")))
        assertTrue(StalkerProtocol.nativeExplicitEndpoint(listOf("folder","LOAD.PHP","")))
        assertTrue(StalkerProtocol.isRpc("/folder/api///"));assertFalse(StalkerProtocol.isRpc("/folder/API/"))
        assertEquals(listOf("folder"),StalkerProtocol.rpcBaseSegments(listOf("folder","api","")))
        assertEquals("stream/a/b.m3u8?mac=$mac",StalkerProtocol.rpcStream("a/b",mac){path,query->path.joinToString("/")+"?"+query.joinToString("&"){it.first+"="+it.second}})
    }
    @Test fun envelopesKeepNullMissingAndAuthenticationDistinct() {
        failure("PORTAL_FORMAT"){StalkerProtocol.unwrap(obj("result" to array()),StalkerFormat.BROWSER)}
        assertSame(ProviderValue.nil,StalkerProtocol.unwrap(reply(ProviderValue.nil),StalkerFormat.BROWSER))
        failure("PORTAL_AUTH"){StalkerProtocol.unwrap(reply(row("error" to "secret")),StalkerFormat.BROWSER)}
        failure("NATIVE_EMPTY"){StalkerProtocol.unwrap(obj("js" to ProviderValue.nil,"result" to array()),StalkerFormat.NATIVE)}
        failure("NATIVE_RESULT"){StalkerProtocol.unwrap(obj(),StalkerFormat.NATIVE)}
        assertTrue(StalkerProtocol.unwrap(obj("result" to array()),StalkerFormat.NATIVE).isArray)
        failure("RPC_ERROR"){StalkerProtocol.unwrap(obj("error" to obj()),StalkerFormat.RPC)}
        failure("RPC_REJECTED"){StalkerProtocol.unwrap(obj("result" to t("false")),StalkerFormat.RPC)}
        assertTrue(StalkerProtocol.textDenied(" \tAccess denied secret"))
    }
    @Test fun browserTokenAndProfileChecksAreRetained() {
        assertEquals("abc+/==",StalkerProtocol.token(row("token" to "abc+/=="),StalkerFormat.BROWSER))
        for(token in listOf("","bad token","a===","\n"))failure("HANDSHAKE"){StalkerProtocol.token(row("token" to token),StalkerFormat.BROWSER)}
        assertEquals("bad token",StalkerProtocol.token(row("token" to "bad token"),StalkerFormat.NATIVE))
        StalkerProtocol.profile(obj("id" to n(0)))
        failure("PROFILE_AUTH"){StalkerProtocol.profile(obj())}
        failure("SECOND_AUTH"){StalkerProtocol.profile(row("status" to "0","auth_second_step" to "1"))}
    }
    @Test fun retriesAreBoundedAndOldFailuresCannotEraseNewTokens() {
        val retry=StalkerRetry();assertFalse(retry.reject(500));assertTrue(retry.reject(401));assertFalse(retry.reject(403))
        val cache=StalkerTokens<String>();cache.put("s","old");cache.put("s","new");cache.invalidate("s","old");assertEquals("new",cache.get("s"))
        cache.invalidate("s","new");assertNull(cache.get("s"))
        repeat(100){cache.put(it.toString(),"t")};cache.put("last","t");assertNull(cache.get("0"));assertEquals("t",cache.get("last"))
    }
    @Test fun browserPaginationCountsRawRowsButRejectsRepeatedPagesFirst() {
        val pages=StalkerPages(StalkerFormat.BROWSER){it["id"].string()}
        pages.accept(obj("data" to array(row("id" to "1")),"total_items" to n(2)))
        failure("REPEAT_PAGE"){pages.accept(obj("data" to array(row("id" to "1")),"total_items" to n(2)))}
        val duplicate=StalkerPages(StalkerFormat.BROWSER){it["id"].string()}
        duplicate.accept(obj("data" to array(row("id" to "1","name" to "first"),row("id" to "1","name" to "last")),"total_items" to n(2)))
        assertTrue(duplicate.done);assertEquals("first",duplicate.rows.single()["name"].string())
    }
    @Test fun malformedTotalsAndEarlyEndsNeverCommitBrowserCatalogs() {
        for(total in listOf("-1","1.2","Infinity","bad"))failure("TOTAL_FORMAT") {StalkerPages(StalkerFormat.BROWSER){""}.accept(obj("data" to array(),"total_items" to t(total)))}
        failure("BROWSER_COUNT"){StalkerPages(StalkerFormat.BROWSER){""}.accept(obj("data" to array(),"total_items" to n(50001)))}
        failure("ROW_ID"){StalkerPages(StalkerFormat.BROWSER){""}.accept(page(obj()))}
        failure("EARLY_PAGE"){StalkerPages(StalkerFormat.BROWSER){""}.accept(obj("data" to array(),"total_items" to n(1)))}
    }
    @Test fun nativePaginationOverwritesDuplicatesAndUsesUniqueCount() {
        val pages=StalkerPages(StalkerFormat.NATIVE){StalkerCatalogs.nativeIdentity(it,"s"){it.joinToString(":")}}
        pages.accept(obj("data" to array(row("id" to "1","cmd" to "first"),row("id" to "1","cmd" to "last")),"total_items" to n(2)))
        assertFalse(pages.done);assertEquals("last",pages.rows.single()["cmd"].string())
        failure("NATIVE_EARLY"){pages.accept(page())}
        val terminal=StalkerPages(StalkerFormat.NATIVE){it["id"].string()};terminal.accept(array(row("id" to "1")));assertTrue(terminal.done)
    }
    @Test fun pageCapsHoldWithoutDeclaredTotals() {
        for((format,limit,code) in listOf(Triple(StalkerFormat.BROWSER,5000,"PAGE_LIMIT"),Triple(StalkerFormat.NATIVE,1000,"NATIVE_PAGE_LIMIT"))) {
            val pages=StalkerPages(format){it["id"].string()}
            repeat(limit-1){pages.accept(page(row("id" to it.toString())))}
            failure(code){pages.accept(page(row("id" to limit.toString())))}
        }
    }
    @Test fun browserSessionRetainsOpaqueReferencesAndStrictGeneration() {
        val session=StalkerBrowserSession("source",7,"fingerprint",{it},{it},{if(it.startsWith("https://"))it else ""})
        val load=session.load(ProviderValue.missing)
        assertEquals("handshake",load.request!!.action);load.accept(reply(row("token" to "t")))
        load.accept(reply(row("status" to "0")));load.accept(reply(array(row("id" to "1","title" to "News"))))
        load.accept(reply(obj("data" to array(row("id" to "42","cmd" to "/opaque","tv_genre_id" to "1")),"total_items" to n(1))))
        assertNull(load.request);assertEquals(2,load.result!!.items.size);assertEquals("News",load.result!!.items[0].group)
        val item=load.result!!.items[0]
        val node=obj("id" to t(item.id),"kind" to t("live"),"portalGeneration" to n(7))
        val play=session.playback(node);assertEquals("/opaque",play.request!!.params.getValue("cmd").string())
        play.accept(reply(row("cmd" to "ffmpeg https://cdn.test/live")));assertEquals("https://cdn.test/live",play.url)
        failure("SESSION_FOLDER"){session.browse(row("portalGeneration" to "7","folderType" to "portal-vod"))}
        failure("SESSION_CATALOG"){session.verify("changed")}
    }
    @Test fun movieSeasonEpisodeHierarchyKeepsIdentityAndAdultInheritance() {
        val parent=row("name" to "Series","movieId" to "90","categoryId" to "8")
        val item=StalkerCatalogs.browserItem(row("id" to "2","is_season" to "1","censored" to "1"),"s","vod",parent,emptyMap(),{it},{it})!!
        assertEquals("s:stalker:portal-season:2",item.id);assertEquals("90",item.movie.string());assertEquals("2",item.season.string());assertTrue(item.adult)
        assertNull(StalkerCatalogs.browserItem(row("id" to "x","cmd" to "bad\ncmd"),"s","live",ProviderValue.missing,emptyMap(),{it},{it}))
    }
    @Test fun nativeRpcCatalogKeepsFallbacksAndDuplicateRows() {
        val data=obj("one" to row("id" to "1","genre" to "News"),"two" to row("id" to "1","name" to "Second"))
        val items=StalkerCatalogs.rpcRows(data).mapNotNull {StalkerCatalogs.nativeItem(it,"s",emptyMap(),true,{it},{"stream/$it"},{it.joinToString(":")})}
        assertEquals(2,items.size);assertEquals(items[0].id,items[1].id);assertTrue(items[0].generatedName);assertEquals("stream/1",items[0].url)
    }
    @Test fun nativeLoadRetainsProfileGenresPagesAndRpcHandshakeOrder() {
        val load=StalkerNativeLoad(false,"s",{it},{it},{it.joinToString(":")})
        assertEquals("get_profile",load.request!!.action);load.accept(ProviderValue.nil)
        assertEquals("get_genres",load.request!!.action);load.accept(array())
        assertEquals("get_ordered_list",load.request!!.action);load.accept(page());assertNull(load.request);assertTrue(load.result().isEmpty())
        val rpc=StalkerNativeLoad(true,"s",{it},{it},{it.joinToString(":")});assertEquals("handshake",rpc.request!!.action)
        rpc.accept(obj());assertEquals("get_channels",rpc.request!!.action);rpc.accept(array());assertNull(rpc.request)
    }
    @Test fun nativeLinkPolicyRetainsAutoPrefixRelativeUrlsAndLoopbackRejection() {
        assertEquals("https://p.test/live",StalkerProtocol.link(t("AUTO /live"),StalkerFormat.NATIVE,{"https://p.test$it"},{"p.test"}))
        failure("LOCAL_LINK"){StalkerProtocol.link(row("cmd" to "https://localhost/live"),StalkerFormat.NATIVE,{it},{"localhost"})}
        failure("STREAM_URL"){StalkerProtocol.link(row("cmd" to "auto https://cdn.test/live"),StalkerFormat.BROWSER,{if(it.startsWith("https"))it else ""},{""})}
    }
    @Test fun headersAndRequestOrderingStayClientSpecific() {
        val request=StalkerProtocol.handshake()
        assertEquals(listOf("type","action","token","JsHttpRequest"),StalkerProtocol.query(request,StalkerFormat.BROWSER).map{it.first})
        assertEquals(listOf("type","action","JsHttpRequest","token"),StalkerProtocol.query(request,StalkerFormat.NATIVE).map{it.first})
        val headers=StalkerProtocol.headers(mac,"en","UTC",ProviderValue.missing,"t",StalkerLocation("",""),StalkerFormat.NATIVE,{it})
        assertEquals("mac=00:1A:79:01:02:03; stb_lang=en; timezone=UTC",headers["Cookie"]);assertEquals("Bearer t",headers["Authorization"])
        assertEquals(listOf("jsonrpc","id","method","params"),StalkerProtocol.rpc("handshake",mac).properties.keys.toList())
    }
    @Test fun legacyRpcRetriesAndRetainsNumericParsing() {
        val client=LegacyStalker("https://p.test///",mac);assertEquals("https://p.test/stalker_portal/api/",client.endpoint)
        client.accept(obj("result" to n(0)));assertEquals("handshake",client.request!!["method"].string())
        client.accept(obj("result" to obj()));assertEquals("get_channels",client.request!!["method"].string())
        client.accept(obj("result" to array(row("id" to "7","name" to "Name","archive" to "0x10"))))
        assertEquals(16.0,client.catalog {0.0}.entries.single().hours)
        val programmes=client.guide(obj("result" to array(row("start" to "0x10","end" to "32s"))))!!
        assertEquals(16.0,programmes.single().start);assertEquals(32.0,programmes.single().end)
        val failed=LegacyStalker("",mac);failed.accept(obj());failure("LEGACY_CONNECT"){failed.accept(obj())}
    }
}
