package play.ott.core

data class LegacyStalkerEntry(val id: Double, val name: ProviderValue, val epg: String, val group: String,
    val category: Int, val logo: ProviderValue, val url: ProviderValue, val mode: String, val hours: Double)
data class LegacyStalkerCatalog(val entries: List<LegacyStalkerEntry>, val groups: Map<String,List<Double>>)

/** FOSS JSON-RPC dialect. Existing numeric/hash identities and handshake retry survive. */
class LegacyStalker(val portal: String, private val mac: String) {
    private var stage=0
    private var attempts=0
    var channels=ProviderValue.missing
        private set
    val endpoint get()=portal.trimEnd('/')+"/stalker_portal/api/"
    val request get()=if(stage==2)null else api(if(stage==0)"handshake" else "get_channels")
    fun api(method: String, params: Map<String,ProviderValue> = emptyMap())=StalkerProtocol.rpc(method,mac,params,true)
    fun accept(response: ProviderValue) {
        if(stage==0) {
            if(response["result"].truthy())stage=1
            else if(++attempts==2)throw StalkerFailure("LEGACY_CONNECT")
        } else {
            if(!response["result"].truthy())throw StalkerFailure("LEGACY_CHANNELS")
            channels=response["result"];stage=2
        }
    }
    fun catalog(hash: (ProviderValue)->Double): LegacyStalkerCatalog {
        var rows=channels
        if(rows.isObject) {
            val selected=firstTruthy(rows["data"],rows["items"],rows["channels"],ProviderValue.array())
            rows=if(selected.isArray)selected else ProviderValue.array(rows.properties.values.filter { it.isObject && it["name"].truthy() })
        }
        val entries=mutableListOf<LegacyStalkerEntry>();val seen=mutableSetOf<Double>();val groups=linkedMapOf<String,MutableList<Double>>()
        val groupCategories=mutableMapOf<String,Int>()
        for(row in rows.elements) {
            if(!row.truthy() || !row["name"].truthy())continue
            val id=if(row["id"].truthy())row["id"].number() else hash(row["name"])
            var category=firstTruthy(row["genre"],row["categories"],row["category"],ProviderValue.text("Other"))
            if(category.isArray)category=firstTruthy(category.elements.firstOrNull() ?: ProviderValue.missing,ProviderValue.text("Other"))
            val group=if(category.kind==ProviderValueKind.TEXT)category.scalar else "Other"
            if(group.isNotEmpty() && id!=0.0 && !id.isNaN())groups.getOrPut(group){
                groupCategories[group]=groups.size+2
                mutableListOf()
            }.add(id)
            if(!id.isNaN() && !seen.add(id))continue
            val url=if(row["url"].truthy())row["url"] else ProviderValue.text(portal.trimEnd('/')+"/stalker_portal/stream/"+row["id"].string()+".m3u8?mac="+mac)
            var logo=firstTruthy(row["logo"],row["icon"],row["tv_icon"],ProviderValue.text(""))
            if(logo.kind==ProviderValueKind.TEXT && !logo.scalar.startsWith("http")) {
                if(logo.scalar.startsWith("//"))logo=ProviderValue.text((if(portal.startsWith("https"))"https:" else "http:")+logo.scalar)
                else if(logo.scalar.startsWith('/'))logo=ProviderValue.text(portal.trimEnd('/')+logo.scalar)
            }
            val archive=integer(row["archive"]).takeIf { it!=0.0 } ?: integer(row["archive_duration"])
            entries.add(LegacyStalkerEntry(id,row["name"],firstTruthy(row["id"],row["ch_id"],ProviderValue.text("")).string(),group,
                groupCategories[group] ?: 1,logo,url,if(row["archive"].truthy())"append" else "",archive))
        }
        return LegacyStalkerCatalog(entries,groups)
    }
    fun guideRequest(channel: ProviderValue, clock: ()->Double): ProviderValue=api("get_epg",linkedMapOf(
        "ch_id" to channel,"from" to ProviderValue(ProviderValueKind.NUMBER,kotlin.math.floor(clock()-86400).toLong().toString()),
        "mac" to ProviderValue.text(mac),"to" to ProviderValue(ProviderValueKind.NUMBER,kotlin.math.floor(clock()+86400).toLong().toString())))
    fun guide(response: ProviderValue): List<LegacyXtreamProgramme>? {
        val rows=response["result"];if(!rows.isArray)return null
        return rows.elements.mapNotNull { row->
            val start=integer(row["start_timestamp"]).takeIf { it!=0.0 } ?: integer(row["start"])
            val end=integer(row["end_timestamp"]).takeIf { it!=0.0 } ?: integer(row["end"])
            if(start==0.0 || end==0.0)null else LegacyXtreamProgramme(firstTruthy(row["name"],row["title"],ProviderValue.text("No title")),
                firstTruthy(row["descr"],row["description"],ProviderValue.text("")),start,end)
        }
    }
    private fun integer(value: ProviderValue): Double {
        val input=CoreText.trim(value.string());val negative=input.startsWith('-');val unsigned=if(input.startsWith('-') || input.startsWith('+'))input.drop(1) else input
        val number=if(unsigned.startsWith("0x",true))CoreNumber.javascript("0x"+unsigned.drop(2).takeWhile { it in '0'..'9' || it.lowercaseChar() in 'a'..'f' })*(if(negative)-1 else 1)
            else ProviderPlaylist.integer(input)
        return if(number.isNaN())0.0 else number
    }
}
