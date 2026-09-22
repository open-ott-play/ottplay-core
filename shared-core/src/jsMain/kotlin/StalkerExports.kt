@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.*

@JsExport
fun stalkerTextDenied(value: String)=StalkerProtocol.textDenied(value)

@JsExport
fun stalkerConfig(input: dynamic): dynamic=try {
    val config=wire(input)
    val location=StalkerProtocol.browserConfiguration(config["url"].string(),config["mac"].string(),config["profile"])
    val result: dynamic=js("({})")
    result.endpoint=location.endpoint;result.referer=location.referer
    result.fingerprint=location.endpoint+"\n"+config["mac"].string()+"\n"+js("JSON.stringify(input.profile)").unsafeCast<String>()
    result
}catch(error:StalkerFailure){failure(error.code)}

@JsExport
class StalkerClient(input: dynamic, generation: Int, private val component: (String)->String,
    relative: (String)->String, absolute: (String)->String) {
    private val config=wire(input)
    private val session=StalkerBrowserSession(config["id"].string(),generation,config["fingerprint"].string(),component,relative,absolute)
    fun verify(fingerprint: String): dynamic=try {session.verify(fingerprint);null}catch(error:StalkerFailure){failure(error.code)}
    fun load(): dynamic=operation(session.load(config["profile"]))
    fun browse(node: dynamic): dynamic=try {operation(session.browse(wire(node)))}catch(error:StalkerFailure){failure(error.code)}
    fun playback(node: dynamic): dynamic=try {operation(session.playback(wire(node)))}catch(error:StalkerFailure){failure(error.code)}
    private fun operation(value: StalkerBrowserOperation): dynamic {
        val result: dynamic=js("({})")
        result.request={
            value.request?.let { request->
                val outgoing: dynamic=js("({})")
                outgoing.url=config["endpoint"].string()+"?"+StalkerProtocol.query(request,StalkerFormat.BROWSER).joinToString("&") { component(it.first)+"="+component(it.second) }
                outgoing.headers=js("({})")
                StalkerProtocol.headers(config["mac"].string(),config["language"].string(),config["timezone"].string(),config["profile"],session.token,
                    StalkerLocation(config["endpoint"].string(),config["referer"].string()),StalkerFormat.BROWSER,component).forEach { (key,v)->outgoing.headers[key]=v }
                outgoing
            }
        }
        result.accept={ response: dynamic->try {value.accept(wire(response));null}catch(error:StalkerFailure){failure(error.code)} }
        result.result={
            val output: dynamic=js("({})")
            if(value.url!=null)output.url=value.url else {
                val catalog=requireNotNull(value.result)
                val items=catalog.items.map { item(it) }.toTypedArray()
                if(catalog.catalog){output.channels=items;output.epgUrls=emptyArray<String>()}else output.items=items
                output.warnings=catalog.warnings.toTypedArray()
            }
            output
        }
        return result
    }
    private fun item(value: StalkerItem): dynamic {
        val result: dynamic=js("({})")
        result.id=value.id;result.name=value.name;result.kind=value.kind;result.group=value.group
        result.sourceId=session.source;result.portalGeneration=session.generation
        if(value.folder=="portal-vod") {result.folderType=value.folder;return result}
        result.adult=value.adult
        if(value.folder=="portal-category") {result.folderType=value.folder;result.categoryId=unwire(value.category);return result}
        result.provider="stalker";result.logo=value.logo;result.tvgId=value.epgId;result.description=value.description
        if(value.folder.isNotEmpty()) {
            result.folderType=value.folder;result.movieId=unwire(value.movie);result.seasonId=unwire(value.season);result.episodeId=unwire(value.episode);result.categoryId=unwire(value.category)
        }
        return result
    }
}

@JsExport
class LegacyStalkerClient(portal: String, mac: String) {
    private val core=LegacyStalker(portal,mac)
    fun endpoint()=core.endpoint
    fun api(method: String, params: dynamic): dynamic=unwire(core.api(method,wire(params).properties))
    fun request(): dynamic=core.request?.let(::unwire)
    fun accept(response: dynamic): dynamic=try {core.accept(wire(response));null}catch(error:StalkerFailure){failure(error.code)}
    fun catalog(hash: (dynamic)->Double): dynamic {
        val catalog=core.catalog {hash(unwire(it))};val result: dynamic=js("({})")
        result.ids=catalog.entries.map {it.id}.toTypedArray();result.channels=js("Object.create(null)");result.groups=js("Object.create(null)")
        result.groupOrder=catalog.groups.keys.toTypedArray()
        catalog.groups.forEach { (key,ids)->result.groups[key]=ids.toTypedArray() }
        catalog.entries.forEach { entry->
            result.channels[entry.id]=legacyChannel(entry.name,entry.epg,entry.category,entry.group,entry.logo,unwire(entry.url),entry.mode,entry.hours)
        }
        return result
    }
    fun guideRequest(channel: dynamic, clock: ()->Double): dynamic=unwire(core.guideRequest(wire(channel),clock))
    fun guide(response: dynamic): dynamic=legacyGuide(core.guide(wire(response)))
}
