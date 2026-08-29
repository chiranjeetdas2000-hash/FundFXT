import MetaTrader5 as mt5
import websockets
import asyncio
import json

LOGIN = 235204869
PASSWORD = "Silward@12"
SERVER = "HFMarketsGlobal-Demo4"
WS_PORT = 8765

SYMBOLS = [
    "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD",
    "EURGBP", "EURJPY", "EURCHF", "EURCAD", "GBPJPY", "GBPCHF", "GBPCAD",
    "AUDJPY", "AUDCAD", "AUDCHF", "CADJPY", "CHFJPY", "NZDJPY", "NZDCAD", "NZDCHF",
    "XAUUSD", "XAGUSD"
]

def connect_mt5():
    if not mt5.initialize(login=LOGIN, password=PASSWORD, server=SERVER):
        print("MT5 connect nahi hua:", mt5.last_error())
        return False
    return True

async def stream_prices(websocket):
    while True:
        data = {}
        for sym in SYMBOLS:
            try:
                tick = mt5.symbol_info_tick(sym)
                if tick:
                    sym_info = mt5.symbol_info(sym)
                    spread_points = sym_info.spread if sym_info else 0
                    
                    high = sym_info.bid_high if sym_info else tick.bid
                    low = sym_info.bid_low if sym_info else tick.bid
                    
                    change_pct = 0.0
                    if high != low and low != 0:
                        change_pct = ((tick.bid - low) / low * 100)
                        
                    data[sym] = {
                        "bid": tick.bid,
                        "ask": tick.ask,
                        "spread": spread_points,
                        "change_pct": round(change_pct, 2)
                    }
            except Exception as e:
                print(f"Error processing {sym}: {e}")
        
        if data:
            await websocket.send(json.dumps(data))
        await asyncio.sleep(0.5)

async def main():
    if not connect_mt5():
        return
    async with websockets.serve(stream_prices, "0.0.0.0", WS_PORT, origins=None):
        print(f"🚀 WebSocket server ws://localhost:{WS_PORT} par chal raha hai")
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Server band kiya gaya.")
        mt5.shutdown()