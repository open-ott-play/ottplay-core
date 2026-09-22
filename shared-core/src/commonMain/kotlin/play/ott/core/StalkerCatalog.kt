package play.ott.core

/** One pagination accumulator with explicit retained browser/native completion policies. */
class StalkerPages(private val format: StalkerFormat, private val identity: (ProviderValue)->String?) {
    var page=1
        private set
    var done=false
        private set
    private var rawCount=0
    private var expected: Int?=null
    private val records=linkedMapOf<String,ProviderValue>()
    val rows get()=records.values.toList()
    fun accept(value: ProviderValue) {
        check(!done)
        val browser=format==StalkerFormat.BROWSER
        val rows=if(!browser && value.isArray)value else value["data"]
        if(!rows.isArray)throw StalkerFailure(if(browser)"PAGE_FORMAT" else "NATIVE_PAGE")
        val total=if(browser) {
            if(!value["total_items"].present)null else value["total_items"].number().also {
                if(!it.isFinite() || it<0 || kotlin.math.floor(it)!=it)throw StalkerFailure("TOTAL_FORMAT")
            }
        } else value["total_items"].primitive().toIntOrNull()?.toDouble()
        if(total!=null && total>(if(browser)50_000 else 100_000))throw StalkerFailure(if(browser)"BROWSER_COUNT" else "NATIVE_COUNT")
        if(!browser && total!=null && total>=0)expected=total.toInt()
        val before=records.size
        for(row in rows.elements) {
            if(browser && (!row.truthy() || !row["id"].present))throw StalkerFailure("ROW_ID")
            val id=identity(row) ?: continue
            if(!browser || id !in records)records[id]=row
        }
        rawCount+=rows.elements.size
        if(browser) {
            if(rows.elements.isEmpty() && total!=null && rawCount<total)throw StalkerFailure("EARLY_PAGE")
            if(rows.elements.isNotEmpty() && records.size==before)throw StalkerFailure("REPEAT_PAGE")
            if(rows.elements.isEmpty() || total!=null && rawCount>=total){done=true;return}
            if(page>=5000 || records.size>=50000)throw StalkerFailure("PAGE_LIMIT")
        } else {
            if(rows.elements.isEmpty()) {
                if(expected!=null && records.size<expected!!)throw StalkerFailure("NATIVE_EARLY")
                done=true;return
            }
            if(expected!=null && records.size>=expected!!){done=true;return}
            if(records.size==before)throw StalkerFailure("NATIVE_REPEAT")
            val size=value["max_page_items"].primitive().toIntOrNull()
            if(expected==null && (value.isArray || size!=null && rows.elements.size<size)){done=true;return}
            if(page>=1000)throw StalkerFailure("NATIVE_PAGE_LIMIT")
        }
        page++
    }
    fun request(type: String, filters: Map<String,ProviderValue>): StalkerRequest {
        val params=if(format==StalkerFormat.BROWSER)stalkerValues("p" to page.toString(),"fav" to "0","sortby" to if(type=="itv")"number" else "name").apply { putAll(filters) }
            else stalkerValues("genre" to "*","p" to page.toString(),"fav" to "0","sortby" to "number","hd" to "0")
        return StalkerRequest(type,"get_ordered_list",params)
    }
}

object StalkerCatalogs {
    fun groups(data: ProviderValue, format: StalkerFormat): Map<String,String> {
        if(!data.isArray)throw StalkerFailure(if(format==StalkerFormat.BROWSER)"GENRES_FORMAT" else "NATIVE_GENRES")
        val groups=linkedMapOf<String,String>()
        for(row in data.elements)if(format==StalkerFormat.BROWSER) {
            if(row.truthy() && row["id"].present)groups[row["id"].string()]=row["title"].trimmed().ifEmpty { "Other" }
        } else if(row.isObject)groups[row["id"].primitive()]=row["title"].primitive().ifBlank { row["name"].primitive() }
        return groups
    }
    fun nativeIdentity(row: ProviderValue, source: String, hash: (List<String>)->String): String? {
        val id=row["id"].primitive().ifBlank { row["ch_id"].primitive() }
        val command=row["cmd"].primitive().ifBlank { row["url"].primitive() }
        return if(row.isObject && id.isNotBlank() && command.isNotBlank())hash(listOf(source,"stalker",id)) else null
    }
    fun nativeItem(row: ProviderValue, source: String, groups: Map<String,String>, rpc: Boolean,
        resolve: (String)->String, stream: (String)->String, hash: (List<String>)->String): StalkerItem? {
        if(!row.isObject)return null
        val id=row["id"].primitive().ifBlank { row["ch_id"].primitive() }
        if(id.isBlank())return null
        val rawGroup=if(rpc)rpcCategory(row) else groups[row["tv_genre_id"].primitive()].orEmpty().ifBlank { row["genre"].primitive() }
        val name=row["name"].primitive()
        val logo=if(rpc)row["logo"].primitive().ifBlank { row["icon"].primitive() }.ifBlank { row["tv_icon"].primitive() } else row["logo"].primitive()
        val url=if(rpc)row["url"].primitive().takeIf(String::isNotBlank)?.let(resolve) ?: stream(id) else row["cmd"].primitive().ifBlank { row["url"].primitive() }
        return StalkerItem(hash(listOf(source,"stalker",id)),id,name.ifBlank { "Channel $id" },group=rawGroup.ifBlank { "Other" },
            logo=resolve(logo),epgId=row["xmltv_id"].primitive().ifBlank { id },url=url,generatedName=name.isBlank(),generatedGroup=rawGroup.isBlank())
    }
    fun rpcRows(value: ProviderValue): List<ProviderValue> = when {
        value.isArray->value.elements
        value.isObject->listOf("data","items","channels").map { value[it] }.firstOrNull { it.isArray }?.elements ?: value.properties.values.filter { it.isObject }
        else->throw StalkerFailure("RPC_CATALOG")
    }
    private fun rpcCategory(row: ProviderValue)=listOf("genre","categories","category").map { key->
        val value=row[key];if(value.isArray)value.elements.firstOrNull()?.primitive().orEmpty() else value.primitive()
    }.firstOrNull(String::isNotBlank).orEmpty()

    fun browserItem(row: ProviderValue, source: String, kind: String, node: ProviderValue, groups: Map<String,String>,
        component: (String)->String, resolve: (String)->String): StalkerItem? {
        val id=row["id"].trimmed();if(id.isEmpty())return null
        var folder="";var movie=node["movieId"];var season=node["seasonId"];var episode=node["episodeId"]
        if(kind=="vod")when {
            row["is_season"].flag()->{folder="portal-season";season=ProviderValue.text(id)}
            row["is_episode"].flag()->{folder="portal-episode";episode=ProviderValue.text(id)}
            row["is_series"].flag() || row["has_files"].positive()>0->{folder="portal-movie";movie=ProviderValue.text(id)}
        }
        val command=row["cmd"].trimmed()
        if(folder.isEmpty() && (command.isEmpty() || command.any { it in "\r\n\u0000" }))return null
        return StalkerItem(component(CoreText.trim(source))+":stalker:"+folder.ifEmpty { kind }+":"+component(id),id,
            firstTruthy(row["name"],row["title"]).trimmed().ifEmpty { "Item $id" },if(folder.isEmpty())kind else "folder",
            groups[row["tv_genre_id"].string()].orEmpty().ifEmpty { if(node["name"].truthy())node["name"].string() else "Other" },
            resolve(firstTruthy(row["logo"],row["screenshot_uri"]).trimmed()),row["xmltv_id"].trimmed(),row["description"].trimmed(),
            row["censored"].flag() || row["lock"].flag() || node["adult"].truthy(),folder=folder,movie=movie,season=season,episode=episode,
            category=node["categoryId"],command=command,series=firstTruthy(row["series_number"],ProviderValue(ProviderValueKind.NUMBER,"0")))
    }
}

/** Native request order; the host fulfills each request with its authenticated transport. */
class StalkerNativeLoad(private val rpc: Boolean, private val source: String, private val resolve: (String)->String,
    private val stream: (String)->String, private val hash: (List<String>)->String) {
    private var stage=0
    private var groups=emptyMap<String,String>()
    private val pages=StalkerPages(StalkerFormat.NATIVE) { StalkerCatalogs.nativeIdentity(it,source,hash) }
    private var rows=emptyList<ProviderValue>()
    val request: StalkerRequest? get()=if(rpc)when(stage){0->StalkerRequest("","handshake");1->StalkerRequest("","get_channels");else->null}
        else when(stage){0->StalkerProtocol.profileRequest(ProviderValue.missing,StalkerFormat.NATIVE);1->StalkerRequest("itv","get_genres");2->pages.request("itv",emptyMap());else->null}
    fun accept(data: ProviderValue) {
        check(request!=null)
        if(rpc) { if(stage==1)rows=StalkerCatalogs.rpcRows(data);stage++;return }
        when(stage){0->stage++;1->{groups=StalkerCatalogs.groups(data,StalkerFormat.NATIVE);stage++};else->{pages.accept(data);if(pages.done){rows=pages.rows;stage++}}}
    }
    fun result(): List<StalkerItem> { check(request==null);return rows.mapNotNull { StalkerCatalogs.nativeItem(it,source,groups,rpc,resolve,stream,hash) } }
}
