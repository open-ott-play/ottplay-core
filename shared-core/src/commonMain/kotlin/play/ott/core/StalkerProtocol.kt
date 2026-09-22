package play.ott.core

enum class StalkerFormat { BROWSER, NATIVE, RPC }
class StalkerFailure(val code: String) : Exception(code)
data class StalkerRequest(val type: String, val action: String, val params: Map<String, ProviderValue> = emptyMap())
data class StalkerLocation(val endpoint: String, val referer: String)
data class StalkerItem(
    val id: String, val providerId: String, val name: String, val kind: String = "live", val group: String = "Other",
    val logo: String = "", val epgId: String = "", val description: String = "", val adult: Boolean = false,
    val url: String = "", val folder: String = "", val movie: ProviderValue = ProviderValue.missing,
    val season: ProviderValue = ProviderValue.missing, val episode: ProviderValue = ProviderValue.missing,
    val category: ProviderValue = ProviderValue.missing, val command: String = "", val series: ProviderValue = ProviderValue.missing,
    val generatedName: Boolean = false, val generatedGroup: Boolean = false,
)
data class StalkerResult(val items: List<StalkerItem>, val warnings: List<String> = emptyList(), val catalog: Boolean = false)
internal fun stalkerValues(vararg pairs: Pair<String, String>) = linkedMapOf(*pairs.map { it.first to ProviderValue.text(it.second) }.toTypedArray())
internal fun firstTruthy(vararg values: ProviderValue) = values.firstOrNull { it.truthy() } ?: values.lastOrNull() ?: ProviderValue.missing

/** Protocol choices only. URL parsing/encoding, HTTP, JSON and locking belong to the host. */
object StalkerProtocol {
    fun handshake()=StalkerRequest("stb","handshake",stalkerValues("token" to ""))
    fun browserLocation(url: String): StalkerLocation {
        val clean=url.substringBefore('?').substringBefore('#')
        val lower=clean.lowercase()
        val suffix=listOf("/c/index.html/", "/c/index.html", "/c/", "/c").firstOrNull { lower.endsWith(it) }
        if(suffix!=null) { val base=clean.dropLast(suffix.length); return StalkerLocation("$base/server/load.php", "$base/c/") }
        val endpoint=listOf("/server/load.php", "/portal.php", "/load.php").firstOrNull { lower.endsWith(it) }
            ?: throw StalkerFailure("PORTAL_URL")
        return StalkerLocation(clean, clean.dropLast(endpoint.length)+"/c/")
    }
    fun nativeEndpoint(segments: List<String>): List<String> {
        val parts=segments.filter(String::isNotBlank)
        if(parts.lastOrNull()?.endsWith(".php",true)==true)return parts
        return (if(parts.lastOrNull().equals("c",true))parts.dropLast(1) else parts)+listOf("server","load.php")
    }
    fun nativeExplicitEndpoint(segments: List<String>)=segments.filter(String::isNotBlank).lastOrNull()?.endsWith(".php",true)==true
    fun isRpc(path: String)=path.trimEnd('/').endsWith("/api")
    fun rpcBaseSegments(segments: List<String>)=segments.filter(String::isNotBlank).dropLast(1)
    fun rpcStream(id: String, mac: String, render: (List<String>,List<Pair<String,String>>)->String)=render(listOf("stream","$id.m3u8"),listOf("mac" to mac))
    fun validMac(mac: String)=mac.length==17 && mac.withIndex().all { (i,c)->if(i%3==2)c==':' else c in '0'..'9' || c.uppercaseChar() in 'A'..'F' }
    fun browserConfiguration(url: String, mac: String, profile: ProviderValue): StalkerLocation {
        if(!validMac(mac))throw StalkerFailure("SOURCE_MAC")
        val location=browserLocation(url)
        val model=profile["stb_type"]
        if(model.present && (model.string().length !in 1..40 || model.string().any { it !in 'a'..'z' && it !in 'A'..'Z' && it !in '0'..'9' && it!='_' && it!='-' }))throw StalkerFailure("PORTAL_PROFILE")
        return location
    }
    fun textDenied(value: String): Boolean {
        val text=CoreText.trim(value).lowercase()
        return text.startsWith("authorization failed") || text.startsWith("access denied")
    }
    fun unwrap(response: ProviderValue, format: StalkerFormat): ProviderValue {
        if(format==StalkerFormat.BROWSER) {
            if(!response.truthy() || !response.properties.containsKey("js"))throw StalkerFailure("PORTAL_FORMAT")
            val data=response["js"]
            if(data.truthy() && (data["error"].truthy() || data["not_valid_token"].flag()))throw StalkerFailure("PORTAL_AUTH")
            return data
        }
        if(!response.isObject)throw StalkerFailure(if(format==StalkerFormat.RPC)"RPC_FORMAT" else "NATIVE_FORMAT")
        if(format==StalkerFormat.RPC) {
            if(response["error"].present)throw StalkerFailure("RPC_ERROR")
            val result=response["result"]
            if(!result.present)throw StalkerFailure("RPC_EMPTY")
            if(!result.isArray && !result.isObject && result.primitive() in listOf("false","0",""))throw StalkerFailure("RPC_REJECTED")
            return result
        }
        val data=if(response.properties.containsKey("js"))response["js"] else response["result"]
        if(data.kind==ProviderValueKind.MISSING)throw StalkerFailure("NATIVE_RESULT")
        if(data.kind==ProviderValueKind.NULL)throw StalkerFailure("NATIVE_EMPTY")
        if(data.isObject && data["error"].primitive().isNotBlank())throw StalkerFailure("NATIVE_REJECTED")
        return data
    }
    fun token(data: ProviderValue, format: StalkerFormat): String {
        val token=if(format==StalkerFormat.BROWSER)firstTruthy(data["token"],ProviderValue.text("")).string() else data["token"].primitive()
        if(format==StalkerFormat.BROWSER) {
            val plain=token.trimEnd('='); val padding=token.length-plain.length
            if(plain.length !in 1..2048 || padding>2 || plain.any { it !in 'a'..'z' && it !in 'A'..'Z' && it !in '0'..'9' && it !in "._~+/-" })throw StalkerFailure("HANDSHAKE")
        } else if(token.isBlank())throw StalkerFailure("NATIVE_HANDSHAKE")
        return token
    }
    fun profile(data: ProviderValue) {
        if(!data.isObject || !data["id"].present && !data["status"].present || data["status"].present && data["status"].string()!="0" || data["blocked"].flag())throw StalkerFailure("PROFILE_AUTH")
        if(data["auth_second_step"].flag())throw StalkerFailure("SECOND_AUTH")
    }
    fun profileRequest(profile: ProviderValue, format: StalkerFormat): StalkerRequest {
        val values=if(format==StalkerFormat.BROWSER)stalkerValues("stb_type" to "MAG250","hd" to "1","auth_second_step" to "0","not_valid_token" to "0") else stalkerValues("hd" to "1")
        if(format==StalkerFormat.BROWSER)for(key in listOf("stb_type","sn","device_id","device_id2","signature","ver","image_version","hw_version"))if(profile[key].present)values[key]=ProviderValue.text(profile[key].string())
        return StalkerRequest("stb","get_profile",values)
    }
    fun query(request: StalkerRequest, format: StalkerFormat): List<Pair<String,String>> {
        val values=linkedMapOf("type" to request.type,"action" to request.action)
        if(format!=StalkerFormat.BROWSER)values["JsHttpRequest"]="1-xml"
        request.params.forEach { (k,v)->values[k]=v.string() }
        if(format==StalkerFormat.BROWSER)values["JsHttpRequest"]="1-xml"
        return values.toList()
    }
    fun headers(mac: String, language: String, zone: String, profile: ProviderValue, token: String?, location: StalkerLocation,
        format: StalkerFormat, encode: (String)->String): Map<String,String> {
        val browser=format==StalkerFormat.BROWSER
        val headers=linkedMapOf("Cookie" to if(browser)"mac=${encode(mac)}; stb_lang=${encode(language)}; timezone=${encode(zone)}" else "mac=${mac.uppercase()}; stb_lang=en; timezone=UTC")
        if(browser)headers["Referer"]=location.referer
        headers["X-User-Agent"]="Model: "+(if(browser)profile["stb_type"].trimmed().ifEmpty { "MAG250" } else "MAG250")+"; Link: Ethernet"
        if(token!=null && (!browser || token.isNotEmpty()))headers["Authorization"]="Bearer $token"
        return headers
    }
    fun rpc(method: String, mac: String, params: Map<String,ProviderValue> = emptyMap(), legacy: Boolean = false): ProviderValue {
        val values=params.toMutableMap();if(!values.getOrElse("mac"){ProviderValue.missing}.truthy())values["mac"]=ProviderValue.text(mac)
        val body=linkedMapOf<String,ProviderValue>()
        if(legacy)body["id"]=ProviderValue(ProviderValueKind.NUMBER,"1")
        body["jsonrpc"]=ProviderValue.text("2.0");body["id"]=ProviderValue(ProviderValueKind.NUMBER,"1")
        body["method"]=ProviderValue.text(method);body["params"]=ProviderValue.obj(values)
        return ProviderValue.obj(body)
    }
    fun linkRequest(command: String, kind: String = "live", series: ProviderValue = ProviderValue.missing, format: StalkerFormat): StalkerRequest =
        StalkerRequest(if(kind=="live")"itv" else "vod","create_link",stalkerValues("cmd" to command,"series" to (if(series.truthy())series.string() else "0"),"forced_storage" to if(format==StalkerFormat.BROWSER)"undefined" else "0","disable_ad" to "0","download" to "0"))
    fun link(data: ProviderValue, format: StalkerFormat, resolve: (String)->String, hostname: (String)->String): String {
        var command=if(format==StalkerFormat.BROWSER)data["cmd"].trimmed() else data["cmd"].primitive().ifBlank { data.primitive() }.trim()
        val prefix=command.takeWhile { if(format==StalkerFormat.BROWSER)CoreText.trim(it.toString()).isNotEmpty() else it !in " \t\r\n\u000b\u000c" }
        val allowed=if(format==StalkerFormat.BROWSER)listOf("ffmpeg","ffrt") else listOf("ffmpeg","ffrt","auto")
        if(prefix.lowercase() in allowed && command.length>prefix.length)command=command.drop(prefix.length).trimStart()
        if(format!=StalkerFormat.BROWSER)command=command.trim()
        val url=resolve(command)
        if(url.isEmpty())throw StalkerFailure(if(format==StalkerFormat.BROWSER)"STREAM_URL" else "NATIVE_LINK")
        if(format!=StalkerFormat.BROWSER && hostname(url) in listOf("localhost","127.0.0.1","::1"))throw StalkerFailure("LOCAL_LINK")
        return url
    }
}

/** Cache policy is shared; the host serializes access and keys it by its source configuration. */
class StalkerTokens<K> {
    private val values=mutableMapOf<K,String>()
    fun get(key: K)=values[key]
    fun put(key: K, token: String) { if(values.size>=100)values.clear();values[key]=token }
    fun invalidate(key: K, token: String) { if(values[key]==token)values.remove(key) }
}
class StalkerRetry {
    private var retried=false
    fun reject(status: Int?): Boolean { if(retried || status !in listOf(401,403))return false;retried=true;return true }
}
