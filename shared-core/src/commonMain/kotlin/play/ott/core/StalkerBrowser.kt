package play.ott.core

class StalkerBrowserSession(val source: String, val generation: Int, val fingerprint: String,
    private val component: (String)->String, private val resolve: (String)->String, private val absolute: (String)->String) {
    var token=""
        internal set
    private val references=mutableMapOf<String,StalkerItem>()
    internal val prefix get()=component(CoreText.trim(source))+":stalker:"
    private fun current(node: ProviderValue)=node["portalGeneration"].kind==ProviderValueKind.NUMBER && node["portalGeneration"].number()==generation.toDouble()
    fun verify(value: String) { if(value!=fingerprint)throw StalkerFailure("SESSION_CATALOG") }
    fun load(profile: ProviderValue)=StalkerBrowserOperation(this,"load",profile)
    fun browse(node: ProviderValue): StalkerBrowserOperation {
        if(!current(node))throw StalkerFailure("SESSION_FOLDER")
        val folder=node["folderType"].string()
        if(folder !in listOf("portal-vod","portal-category","portal-movie","portal-season","portal-episode"))throw StalkerFailure("UNSUPPORTED_FOLDER")
        return StalkerBrowserOperation(this,if(folder=="portal-vod")"categories" else "browse",node)
    }
    fun playback(node: ProviderValue): StalkerBrowserOperation {
        val item=references[node["id"].string()]
        if(item==null || !current(node))throw StalkerFailure("SESSION_PLAYBACK")
        return StalkerBrowserOperation(this,"resolve",node,StalkerProtocol.linkRequest(item.command,node["kind"].string(),item.series,StalkerFormat.BROWSER))
    }
    internal fun items(rows: List<ProviderValue>, kind: String, parent: ProviderValue, groups: Map<String,String>, catalog: Boolean): StalkerResult {
        val items=mutableListOf<StalkerItem>();val warnings=mutableListOf<String>()
        for(row in rows) {
            val item=StalkerCatalogs.browserItem(row,source,kind,parent,groups,component,resolve)
            if(item==null)warnings.add("Ignored a portal item without a supported media reference")
            else { items.add(item);if(item.folder.isEmpty())references[item.id]=item }
        }
        if(catalog)items.add(StalkerItem(prefix+"vod-root","","Movies and series","folder","Movies",folder="portal-vod"))
        return StalkerResult(items,warnings,catalog)
    }
    internal fun categories(data: ProviderValue): StalkerResult {
        if(!data.isArray)throw StalkerFailure("CATEGORIES_FORMAT")
        val seen=mutableSetOf<String>();val items=mutableListOf<StalkerItem>()
        for(row in data.elements)if(row.truthy() && row["id"].present && seen.add(row["id"].string())) {
            val id=row["id"].string()
            items.add(StalkerItem(prefix+"category:"+component(id),id,row["title"].trimmed().ifEmpty { "Movies" },"folder","Movies",
                adult=row["censored"].flag(),folder="portal-category",category=ProviderValue.text(id)))
        }
        return StalkerResult(items)
    }
    internal fun link(data: ProviderValue)=StalkerProtocol.link(data,StalkerFormat.BROWSER,absolute,{""})
}

class StalkerBrowserOperation internal constructor(private val session: StalkerBrowserSession, private val mode: String,
    private val node: ProviderValue, private val link: StalkerRequest?=null) {
    private var stage=0
    private var groups=emptyMap<String,String>()
    private val pages=StalkerPages(StalkerFormat.BROWSER) { it["id"].string() }
    var result: StalkerResult?=null
        private set
    var url: String?=null
        private set
    val request: StalkerRequest? get() {
        if(result!=null || url!=null)return null
        if(mode=="resolve")return link
        if(mode=="categories")return StalkerRequest("vod","get_categories")
        if(mode=="load")return when(stage) {
            0->StalkerProtocol.handshake()
            1->StalkerProtocol.profileRequest(node,StalkerFormat.BROWSER)
            2->StalkerRequest("itv","get_genres")
            else->pages.request("itv",stalkerValues("genre" to "*"))
        }
        val filters=linkedMapOf("category" to firstTruthy(node["categoryId"],ProviderValue.text("*")),"genre" to ProviderValue.text("*"))
        val folder=node["folderType"].string()
        if(folder in listOf("portal-movie","portal-season","portal-episode"))filters["movie_id"]=node["movieId"]
        if(folder in listOf("portal-season","portal-episode"))filters["season_id"]=node["seasonId"]
        if(folder=="portal-episode")filters["episode_id"]=node["episodeId"]
        return pages.request("vod",filters)
    }
    fun accept(response: ProviderValue) {
        check(request!=null)
        val data=StalkerProtocol.unwrap(response,StalkerFormat.BROWSER)
        when(mode) {
            "resolve"->url=session.link(data)
            "categories"->result=session.categories(data)
            "load"->when(stage) {
                0->{session.token=StalkerProtocol.token(data,StalkerFormat.BROWSER);stage++}
                1->{StalkerProtocol.profile(data);stage++}
                2->{groups=StalkerCatalogs.groups(data,StalkerFormat.BROWSER);stage++}
                else->{pages.accept(data);if(pages.done)result=session.items(pages.rows,"live",ProviderValue.missing,groups,true)}
            }
            else->{pages.accept(data);if(pages.done)result=session.items(pages.rows,"vod",node,emptyMap(),false)}
        }
    }
}
